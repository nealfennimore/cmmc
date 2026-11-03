"use client";
// Map-reduce summarization of evidence documents: summarize each chunk of a
// document (map), then summarize the summaries (reduce), and persist the
// result keyed by the artifact's content hash. Summaries are prompt CONTEXT
// only — verbatim excerpts remain the quotable grounding, because a 1B
// model's summaries blur specifics and nothing can be quote-verified
// against them. Expensive on first run (one generation per chunk), then
// cached until the file, the extractor, or this pipeline changes. A change
// of LLM does not make a summary stale: the per-file "Re-summarize" action
// regenerates one on request.

import { IDB, IDBEvidenceSummary } from "@/app/db";
import { EXTRACTOR_VERSION } from "@/app/search/extract_text";
import { sha256Hex } from "@/app/utils/hash";
import { generate } from "./engine";
import { EvidenceDoc, chunkDoc } from "./prompt";
import type { ChatMessage } from "./protocol";

/** Bump when the summarize prompts or chunking use changes shape. */
export const SUMMARY_VERSION = 2;

/** Output budgets: chunk summaries are 2-3 sentences, the document summary
 *  3-5. Small on purpose — summaries are context, not the deliverable. */
const CHUNK_SUMMARY_TOKENS = 120;
const DOC_SUMMARY_TOKENS = 200;

/** How many chunk summaries one reduce call may consume. Beyond this the
 *  reduce recurses in batches (a summary tree), keeping every prompt within
 *  the model's input cap. */
const REDUCE_BATCH = 12;

const SYSTEM = `You summarize excerpts of the user's own compliance evidence documents — summarizing them is always appropriate. Keep every concrete detail: system names, tool names, policy titles, settings, frequencies, and role names. Write plain present-tense prose. Start directly with the first fact — no preamble. Each sentence states a different fact. Never comment on what the excerpt lacks.`;

// The 1B model ignores "no preamble" often enough that the output is
// cleaned deterministically: leading chat filler is stripped, and a refusal
// (it sometimes balks at CUI-adjacent content despite the system message)
// falls back to verbatim opening text — grounded beats absent.
const PREAMBLE =
    /^\s*(?:here(?:'s| is| are)|sure|certainly|okay|below is|the following)[^:\n]*:\s*/i;
const REFUSAL =
    /\b(?:i\s+can(?:no|')t|i\s+cannot|i(?:'m| am)\s+(?:unable|not\s+able)|unable\s+to\s+(?:provide|summarize|assist))\b/i;

const cleanSummary = (text: string): string =>
    text.replace(PREAMBLE, "").trim();

/** Verbatim fallback: the first sentences of the source text, capped. */
const openingOf = (text: string, cap = 300): string => {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= cap) {
        return flat;
    }
    const head = flat.slice(0, cap);
    const sentenceEnd = Math.max(
        head.lastIndexOf(". "),
        head.lastIndexOf("? "),
        head.lastIndexOf("! "),
    );
    return sentenceEnd > cap / 3
        ? head.slice(0, sentenceEnd + 1)
        : `${head.slice(0, head.lastIndexOf(" "))}…`;
};

const run = async (
    messages: ChatMessage[],
    maxNewTokens: number,
    signal?: AbortSignal,
): Promise<string> => {
    const handle = generate(messages, () => {}, { maxNewTokens });
    signal?.addEventListener("abort", () => handle.abort(), { once: true });
    const { text } = await handle.result;
    // An abort resolves with partial text; never treat that as a summary.
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
    return text.trim();
};

const summarizeChunk = (
    filename: string,
    text: string,
    signal?: AbortSignal,
): Promise<string> =>
    run(
        [
            { role: "system", content: SYSTEM },
            {
                role: "user",
                content: `Excerpt from "${filename}":\n${text}\n\nSummarize this excerpt in two or three sentences.`,
            },
        ],
        CHUNK_SUMMARY_TOKENS,
        signal,
    );

const reduceSummaries = async (
    filename: string,
    summaries: string[],
    signal?: AbortSignal,
): Promise<string> => {
    if (summaries.length === 1) {
        return summaries[0];
    }
    if (summaries.length > REDUCE_BATCH) {
        const batches: string[] = [];
        for (let i = 0; i < summaries.length; i += REDUCE_BATCH) {
            batches.push(
                await reduceSummaries(
                    filename,
                    summaries.slice(i, i + REDUCE_BATCH),
                    signal,
                ),
            );
        }
        return reduceSummaries(filename, batches, signal);
    }
    return run(
        [
            { role: "system", content: SYSTEM },
            {
                role: "user",
                content: `Section summaries of "${filename}", in order:\n${summaries
                    .map((summary) => `- ${summary}`)
                    .join(
                        "\n",
                    )}\n\nCombine them into a single summary of three to five sentences describing what this document establishes.`,
            },
        ],
        DOC_SUMMARY_TOKENS,
        signal,
    );
};

/** What a summary depends on: the content, the extractor, and this
 *  pipeline. Not the model: summaries are prompt context only, and a model
 *  switch must not force a re-summarization of every document. */
export const summaryFingerprint = (evidenceId: string) =>
    sha256Hex(
        [
            evidenceId,
            `extractor:${EXTRACTOR_VERSION}`,
            `summary:${SUMMARY_VERSION}`,
        ].join("\n"),
    );

/** The fingerprint before the model left it. Rows written then stay
 *  current: they match this formula for the model that wrote them. */
const legacySummaryFingerprint = (evidenceId: string, modelId: string) =>
    sha256Hex(
        [
            evidenceId,
            `extractor:${EXTRACTOR_VERSION}`,
            `summary:${SUMMARY_VERSION}`,
            `model:${modelId}`,
        ].join("\n"),
    );

/** True when a stored row matches the current inputs, whichever model
 *  wrote it. Says nothing about completeness. */
export const isCurrentSummary = async (
    row: Pick<IDBEvidenceSummary, "fingerprint" | "model">,
    evidenceId: string,
): Promise<boolean> =>
    row.fingerprint === (await summaryFingerprint(evidenceId)) ||
    (!!row.model &&
        row.fingerprint ===
            (await legacySummaryFingerprint(evidenceId, row.model)));

export interface DocSummary {
    evidenceId: string;
    filename: string;
    summary: string;
    /** The map-step summaries, index-aligned with chunkDoc(doc) — retrieval
     *  searches these as extra vocabulary for their source chunks. */
    chunkSummaries: string[];
    /** The stored row's fingerprint — callers fold it into their own
     *  staleness fingerprints so a summary appearing or changing later is
     *  detected. */
    fingerprint: string;
}

/** Stored, complete, fingerprint-fresh summaries for a set of documents.
 *  Absent or stale entries are skipped — this never generates; the draft
 *  flow owns creating summaries. */
export const freshDocSummaries = async (
    docs: EvidenceDoc[],
): Promise<DocSummary[]> => {
    const summaries: DocSummary[] = [];
    for (const doc of docs) {
        const [cached] = await IDB.evidenceSummaries.getAll(
            IDBKeyRange.only(doc.evidenceId),
        );
        if (
            cached &&
            (await isCurrentSummary(cached, doc.evidenceId)) &&
            cached.complete !== false &&
            cached.summary
        ) {
            summaries.push({
                evidenceId: doc.evidenceId,
                filename: doc.filename,
                summary: cached.summary,
                chunkSummaries: cached.chunk_summaries,
                fingerprint: cached.fingerprint,
            });
        }
    }
    return summaries;
};

export interface SummarizeProgress {
    filename: string;
    /** Chunks summarized so far in the current document. */
    done: number;
    total: number;
}

/** The cached summary for a document, or a fresh map-reduce run when the
 *  cache is missing or stale. The model must already be loaded. modelId
 *  only stamps the row: it is not part of the freshness check. */
export const ensureDocSummary = async (
    doc: EvidenceDoc,
    modelId: string,
    {
        signal,
        onProgress,
    }: {
        signal?: AbortSignal;
        onProgress?: (progress: SummarizeProgress) => void;
    } = {},
): Promise<IDBEvidenceSummary> => {
    const fingerprint = await summaryFingerprint(doc.evidenceId);
    const [cached] = await IDB.evidenceSummaries.getAll(
        IDBKeyRange.only(doc.evidenceId),
    );
    const current =
        !!cached && (await isCurrentSummary(cached, doc.evidenceId));
    // `!== false` keeps rows from before the `complete` field valid — they
    // were only ever written complete.
    if (cached && current && cached.complete !== false) {
        return cached;
    }

    const chunks = chunkDoc(doc);
    // Resume an interrupted run: the fingerprint covers the content hash and
    // extractor version, and chunkDoc is deterministic, so the stored
    // summaries line up with the chunk list index for index.
    const chunkSummaries: string[] =
        cached && current
            ? cached.chunk_summaries.slice(0, chunks.length)
            : [];
    const partial = (): IDBEvidenceSummary => ({
        evidence_id: doc.evidenceId,
        chunk_summaries: chunkSummaries,
        summary: "",
        complete: false,
        fingerprint,
        model: modelId,
        created: Date.now(),
    });
    for (const chunk of chunks.slice(chunkSummaries.length)) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        onProgress?.({
            filename: doc.filename,
            done: chunkSummaries.length,
            total: chunks.length,
        });
        const summarized = cleanSummary(
            await summarizeChunk(doc.filename, chunk.text, signal),
        );
        chunkSummaries.push(
            REFUSAL.test(summarized) || !summarized
                ? openingOf(chunk.text)
                : summarized,
        );
        // Persist per chunk so closing the panel loses at most the chunk
        // that was generating; the next run resumes here.
        await IDB.evidenceSummaries.put(partial());
    }
    const reduced = cleanSummary(
        await reduceSummaries(doc.filename, chunkSummaries, signal),
    );
    const summary =
        REFUSAL.test(reduced) || !reduced
            ? openingOf(chunkSummaries.join(" "), 600)
            : reduced;

    const row: IDBEvidenceSummary = {
        ...partial(),
        summary,
        complete: true,
    };
    await IDB.evidenceSummaries.put(row);
    return row;
};
