"use client";
// Module-level store + pipeline for the "Draft from evidence" job. The
// pipeline used to live inside DraftPanel, where the modal's unmount effect
// aborted it — so navigating away killed the run. Here the job survives
// client navigation; DraftHost (mounted in the root layout) renders either
// the panel or a minimized chip from this store. One job slot: the worker
// runs one generation at a time, so one slot is correct. The draft itself is
// ephemeral — nothing persists until the user inserts it.

import { ElementWrapper } from "@/api/entities/Framework";
import {
    considerationsForObjective,
    getAssessmentGuidance,
} from "@/api/entities/AssessmentGuide";
import { expectedReviewState } from "@/app/ai/review";
import { rankDraftChunks } from "@/app/ai/retrieval";
import { IDB } from "@/app/db";
import {
    DRAFT_MAX_NEW_TOKENS,
    evidenceCharBudget,
    resolveUsableModel,
} from "@/app/llm/config";
import { getDeviceCapabilities } from "@/app/llm/capabilities";
import {
    GenerateHandle,
    ensureLoaded,
    generate,
    getContextTokens,
    subscribeLlmStatus,
} from "@/app/llm/engine";
import {
    EvidenceChunk,
    ReviewFinding,
    buildMessages,
    chunkDoc,
    gatherEvidence,
    selectChunks,
    summarizeQuery,
} from "@/app/llm/prompt";
import { ensureDocSummary } from "@/app/llm/summarize";
import {
    getSelectedModelId,
    isSummaryContextEnabled,
} from "@/app/llm/settings";
import { pauseSummarySync } from "@/app/llm/summary_sync";

export type DraftJobPhase = "preparing" | "generating" | "done" | "error";

export interface DraftJobState {
    requirement: ElementWrapper;
    subStatements: { id: string; text: string }[];
    focusId?: string;
    /** window.location.pathname captured at start — where Insert works. */
    returnPath: string;
    phase: DraftJobPhase;
    statusNote: string;
    draft: string;
    chunks: EvidenceChunk[];
    usedOverviews: { filename: string; summary: string }[];
    unreadable: string[];
    findings: ReviewFinding[];
    staleFindings: number;
    prompt: string;
    error: string | null;
    minimized: boolean;
    /** Reached done/error while minimized; cleared on restore. */
    attention: boolean;
}

type Listener = (job: DraftJobState | null) => void;

let job: DraftJobState | null = null;
const listeners = new Set<Listener>();

// Pipeline internals, not part of the snapshot.
let abortController: AbortController | null = null;
let handle: GenerateHandle | null = null;
let runId = 0;

const emit = () => listeners.forEach((listener) => listener(job));

/** Immutable replacement so the useSyncExternalStore referential check
 *  sees every update. No-op once the job is closed. */
const patch = (partial: Partial<DraftJobState>) => {
    if (!job) {
        return;
    }
    job = { ...job, ...partial };
    emit();
};

export const getDraftJob = (): DraftJobState | null => job;

export const subscribeDraftJob = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const isDraftJobActive = (): boolean =>
    job?.phase === "preparing" || job?.phase === "generating";

/** The deterministic tail of a draft: a gaps list derived from the stored
 *  review verdicts and the list of files the excerpts came from. Kept out of
 *  the model's hands — it dropped, truncated, or embellished both whenever
 *  it was asked to write them. */
const draftAppendix = (
    findings: ReviewFinding[],
    chunks: EvidenceChunk[],
    overviews: { filename: string; summary: string }[],
): string => {
    const gaps = findings.filter((finding) => finding.verdict !== "met");
    const parts: string[] = [];
    if (findings.length) {
        parts.push(
            gaps.length
                ? `Gaps (from the evidence review):\n${gaps
                      .map(
                          (finding) =>
                              `- ${finding.citation} — ${finding.verdict}${finding.reason ? `: ${finding.reason}` : ""}`,
                      )
                      .join("\n")}`
                : "Gaps: none evident (per the evidence review).",
        );
    }
    if (chunks.length) {
        const files = [...new Set(chunks.map((chunk) => chunk.filename))];
        parts.push(`Sources: ${files.join(", ")}`);
    }
    if (overviews.length) {
        parts.push(
            `Document summaries used: ${overviews
                .map((overview) => overview.filename)
                .join(", ")}`,
        );
    }
    return parts.join("\n\n");
};

// Objectives can be long; cap what enters the prompt (~600 tokens shared
// with the statement, see llm/config.ts budget notes).
const MAX_OBJECTIVE_CHARS = 1600;
const MAX_STATEMENT_CHARS = 1200;

const run = async () => {
    if (!job) {
        return;
    }
    const { requirement, subStatements, focusId } = job;
    const requirementId = requirement.element_identifier;
    const thisRun = ++runId;
    abortController?.abort();
    const aborter = new AbortController();
    abortController = aborter;
    patch({
        phase: "preparing",
        statusNote: "Preparing…",
        draft: "",
        error: null,
    });
    // Interactive work excludes the background summarizer for the whole
    // pipeline — its idle gaps between generations must not be filled.
    const resume = await pauseSummarySync();
    // Mirror model-load progress into the status note, preparing phase only.
    const unsubscribeStatus = subscribeLlmStatus((status) => {
        if (
            status.phase === "loading" &&
            thisRun === runId &&
            job?.phase === "preparing"
        ) {
            patch({
                statusNote: `Loading model… ${Math.round((status.progress ?? 0) * 100)}%`,
            });
        }
    });
    try {
        // The selection falls back to the default model when this device
        // cannot run it. Summaries below are stamped with the resolved
        // model's id, and review.ts looks them up the same way.
        const model = resolveUsableModel(
            getSelectedModelId(),
            await getDeviceCapabilities(),
        );
        if (!model) {
            throw new Error("No model can run on this device.");
        }
        patch({ statusNote: "Loading model…" });
        await ensureLoaded(model);
        if (thisRun !== runId) {
            return;
        }

        patch({ statusNote: "Reading evidence…" });
        const { docs, unreadable: skipped } =
            await gatherEvidence(requirementId);
        patch({ unreadable: skipped });
        if (!docs.length) {
            throw new Error(
                "None of the attached evidence has readable text. Attach documents with text content, or wait for text extraction to finish.",
            );
        }

        // Map-reduce document summaries: cached after the first run, so
        // this is slow exactly once per file/pipeline version. With the
        // setting off, the draft skips them: no summarization run, and the
        // excerpts below get the whole evidence budget.
        const overviews: { filename: string; summary: string }[] = [];
        for (const doc of isSummaryContextEnabled() ? docs : []) {
            patch({ statusNote: `Summarizing ${doc.filename}…` });
            const row = await ensureDocSummary(doc, model.id, {
                signal: aborter.signal,
                onProgress: ({ filename, done, total }) =>
                    patch({
                        statusNote: `Summarizing ${filename} (${done + 1}/${total})…`,
                    }),
            });
            if (thisRun !== runId) {
                return;
            }
            overviews.push({
                filename: doc.filename,
                summary: row.summary,
            });
        }
        patch({ usedOverviews: overviews });

        // Stored objective-review verdicts for this requirement (or just
        // the focused control): extra grounding beyond the raw excerpts.
        // Skip failed rows, and rows whose fingerprint says the evidence
        // or pipeline changed since the review ran.
        const reviewRows = (
            await IDB.objectiveReviews.getAll(
                IDBKeyRange.only(requirementId),
                "requirement_id",
            )
        )
            .filter(
                (row) => row.verdict !== "error" && row.verdict !== "unparsed",
            )
            .filter((row) => !focusId || row.objective_id === focusId)
            .sort((a, b) => a.objective_id.localeCompare(b.objective_id));
        const { fingerprint } = await expectedReviewState(requirementId);
        const freshRows = fingerprint
            ? reviewRows.filter((row) => row.fingerprint === fingerprint)
            : reviewRows;
        const reviewFindings: ReviewFinding[] = freshRows.map((row) => ({
            citation: row.citation,
            verdict: row.verdict,
            reason: row.reason,
            quote: row.quote
                ? {
                      text: row.quote.text,
                      filename: row.quote.filename,
                      verified: row.quote.verified,
                  }
                : undefined,
        }));
        patch({
            staleFindings: reviewRows.length - freshRows.length,
            findings: reviewFindings,
        });

        // The letter after the requirement id ("03.01.01.a" → "a") keys
        // the assessment objectives; a focused draft only gets its own.
        const focusLetter = focusId?.startsWith(`${requirementId}.`)
            ? focusId.slice(requirementId.length + 1)
            : undefined;
        const objectives = Object.entries(
            getAssessmentGuidance(requirementId)?.requirement
                .assessment_objectives ?? {},
        )
            .filter(([letter]) => !focusLetter || letter === focusLetter)
            .map(([, objective]) => objective.trim())
            .filter(Boolean);
        while (
            objectives.join(" ").length > MAX_OBJECTIVE_CHARS &&
            objectives.length > 1
        ) {
            objectives.pop();
        }
        const statement = [
            requirement.text,
            ...subStatements.map((sub) => `${sub.id}: ${sub.text}`),
        ]
            .filter(Boolean)
            .join("\n")
            .slice(0, MAX_STATEMENT_CHARS);
        const title = requirement.title ?? "";

        // Verified quotes are known-relevant passages: their chunks are
        // pinned into the prompt, and their wording sharpens the BM25
        // query so retrieval stops surfacing filler excerpts. The
        // "Potential Assessment Considerations" questions bound to this
        // control's letter join the query for the same reason — their
        // concrete noun phrases match evidence language better than the
        // abstract objective wording. Query only; the model never sees
        // them.
        const verifiedQuotes = reviewFindings
            .filter((finding) => finding.quote?.verified)
            .map((finding) => finding.quote!.text);
        const considerations = focusLetter
            ? considerationsForObjective(requirementId, focusLetter)
            : (getAssessmentGuidance(requirementId)?.furtherDiscussion
                  .considerations ?? []);
        // The overviews spend from the same input window as the
        // excerpts. Shrink the excerpt budget by what they use — an
        // overshoot makes the worker trim the tail of the message, which
        // is the task and example, not the excerpts.
        const overviewChars = overviews.reduce(
            (total, overview) =>
                total +
                Math.min(overview.summary.length, 400) +
                overview.filename.length +
                4,
            0,
        );
        const bm25Query = [
            summarizeQuery({ title, statement, objectives }),
            ...considerations,
            ...verifiedQuotes,
        ].join(" ");
        // Dense (embedding) order when the embedder is available;
        // undefined keeps the BM25 order. The pinned-quote chunks still
        // come first inside selectChunks.
        patch({ statusNote: "Finding relevant excerpts…" });
        let ranked: string[] | undefined;
        try {
            ranked = await rankDraftChunks(
                docs.flatMap(chunkDoc),
                `${title} ${requirement.text}`,
                aborter.signal,
            );
        } catch (error) {
            if (thisRun !== runId || aborter.signal.aborted) {
                return;
            }
            throw error;
        }
        if (thisRun !== runId) {
            return;
        }
        const selected = selectChunks(docs, bm25Query, {
            budget: Math.max(
                1200,
                evidenceCharBudget(getContextTokens()) - overviewChars,
            ),
            pinnedQuotes: verifiedQuotes,
            ranked,
        });
        patch({ chunks: selected });

        if (thisRun !== runId) {
            return;
        }
        const messages = buildMessages({
            requirementId,
            title,
            statement,
            objectives,
            chunks: selected,
            overviews,
            findings: reviewFindings,
            focusId,
        });
        // Expose exactly what the model receives ("Show prompt" in the
        // panel), so grounding problems are inspectable instead of guessed
        // at.
        patch({
            prompt: messages
                .map((message) => `[${message.role}]\n${message.content}`)
                .join("\n\n"),
            phase: "generating",
        });
        const generation = generate(
            messages,
            (token) => patch({ draft: (job?.draft ?? "") + token }),
            { maxNewTokens: DRAFT_MAX_NEW_TOKENS },
        );
        handle = generation;
        await generation.result;
        if (thisRun === runId) {
            // The model only writes the narrative prose. Gaps and sources
            // are appended here, in code: the gaps come straight from the
            // review verdicts and the source list from the excerpts that
            // were actually in the prompt, so neither can be invented or
            // truncated away by the model.
            const appendix = draftAppendix(reviewFindings, selected, overviews);
            if (appendix && job) {
                patch({ draft: `${job.draft.trimEnd()}\n\n${appendix}` });
            }
            patch({ phase: "done", attention: job?.minimized ?? false });
        }
    } catch (runError) {
        if (thisRun === runId) {
            patch({
                error:
                    runError instanceof Error
                        ? runError.message
                        : String(runError),
                phase: "error",
                attention: job?.minimized ?? false,
            });
        }
    } finally {
        handle = null;
        unsubscribeStatus();
        resume();
    }
};

/** Start a draft job. No-op while one is preparing/generating; replaces a
 *  finished job. */
export const startDraftJob = (params: {
    requirement: ElementWrapper;
    subStatements: { id: string; text: string }[];
    focusId?: string;
}): void => {
    if (isDraftJobActive()) {
        return;
    }
    job = {
        requirement: params.requirement,
        subStatements: params.subStatements,
        focusId: params.focusId,
        returnPath: window.location.pathname,
        phase: "preparing",
        statusNote: "Preparing…",
        draft: "",
        chunks: [],
        usedOverviews: [],
        unreadable: [],
        findings: [],
        staleFindings: 0,
        prompt: "",
        error: null,
        minimized: false,
        attention: false,
    };
    emit();
    void run();
};

/** The Regenerate path: abort whatever runs and re-run with stored params. */
export const rerunDraftJob = (): void => {
    if (!job) {
        return;
    }
    void run();
};

/** Aborting makes the worker finish early, so the normal "done" path runs
 *  with the partial draft. */
export const stopDraftJob = (): void => {
    handle?.abort();
};

export const minimizeDraftJob = (): void => {
    patch({ minimized: true });
};

export const restoreDraftJob = (): void => {
    patch({ minimized: false, attention: false });
};

/** Abort and discard the job entirely. */
export const closeDraftJob = (): void => {
    runId++;
    abortController?.abort();
    handle?.abort();
    abortController = null;
    handle = null;
    job = null;
    emit();
};
