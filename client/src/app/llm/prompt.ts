// Prompt assembly for "draft a narrative from evidence": pure functions from
// (control text, objectives, extracted evidence text) to chat messages that
// fit the model's context window. Chunk selection reuses the hand-rolled
// BM25 index; no new dependencies.

import { TextIndex } from "@/app/search/text_index";
import { IDB, IDBEvidenceText, IDBEvidenceV3 } from "@/app/db";
import { EVIDENCE_CHAR_BUDGET } from "./config";
import type { ChatMessage } from "./protocol";

/** One artifact's extracted text, joined with its filename for display. */
export interface EvidenceDoc {
    evidenceId: string;
    filename: string;
    text: string;
}

export interface GatheredEvidence {
    docs: EvidenceDoc[];
    /** Filenames attached to the requirement whose content could not be
     *  read (extraction skipped/unsupported/failed) — surfaced in the UI so
     *  the user knows the draft does not cover them. */
    unreadable: string[];
}

/** Load the extracted text of every artifact attached to a requirement. */
export const gatherEvidence = async (
    requirementId: string,
): Promise<GatheredEvidence> => {
    const links = await IDB.evidenceRequirements.getAll(
        IDBKeyRange.only(requirementId),
        "requirement_id",
    );
    const docs: EvidenceDoc[] = [];
    const unreadable: string[] = [];
    for (const link of links) {
        const [meta] = (await IDB.evidence.getAll(
            IDBKeyRange.only(link.evidence_id),
        )) as IDBEvidenceV3[];
        if (!meta) {
            continue;
        }
        const [text] = (await IDB.evidenceText.getAll(
            IDBKeyRange.only(link.evidence_id),
        )) as IDBEvidenceText[];
        if (text?.status === "ok" && text.text.trim()) {
            docs.push({
                evidenceId: meta.id,
                filename: meta.filename,
                text: text.text,
            });
        } else {
            unreadable.push(meta.filename);
        }
    }
    return { docs, unreadable };
};

/** One stored objective-review verdict, reshaped for the draft prompt.
 *  The caller (draft_panel.tsx) filters out error/unparsed/stale rows. */
export interface ReviewFinding {
    /** CMMC citation, e.g. "AC.L2-3.1.1[a]". */
    citation: string;
    verdict: string;
    reason: string;
    quote?: { text: string; filename: string; verified: boolean };
}

const TARGET_CHUNK_CHARS = 1000;
const MAX_CHUNK_CHARS = 2000;
const MAX_CHUNKS_PER_DOC = 3;

export interface EvidenceChunk {
    /** "{evidenceId}#{seq}" — doubles as the index doc id. */
    id: string;
    evidenceId: string;
    filename: string;
    seq: number;
    text: string;
}

/** Paragraph-aware chunking: pack blank-line-separated paragraphs up to
 *  ~1,000 chars, hard-splitting any oversized paragraph. The extractors emit
 *  one line per paragraph/page/row, so newlines are the natural seams. */
export const chunkDoc = (doc: EvidenceDoc): EvidenceChunk[] => {
    const paragraphs = doc.text
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
    const texts: string[] = [];
    let current = "";
    const push = () => {
        if (current) {
            texts.push(current);
            current = "";
        }
    };
    for (const paragraph of paragraphs) {
        if (paragraph.length > MAX_CHUNK_CHARS) {
            push();
            for (
                let offset = 0;
                offset < paragraph.length;
                offset += MAX_CHUNK_CHARS
            ) {
                texts.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARS));
            }
            continue;
        }
        if (current.length + paragraph.length + 1 > TARGET_CHUNK_CHARS) {
            push();
        }
        current = current ? `${current}\n${paragraph}` : paragraph;
    }
    push();
    return texts.map((text, seq) => ({
        id: `${doc.evidenceId}#${seq}`,
        evidenceId: doc.evidenceId,
        filename: doc.filename,
        seq,
        text,
    }));
};

const normalizeForMatch = (text: string): string =>
    text.replace(/\s+/g, " ").trim().toLowerCase();

/** Chunk ids in BM25 order for the query (matching chunks only). */
export const bm25Ranking = (chunks: EvidenceChunk[], query: string): string[] => {
    const index = new TextIndex(["text", "filename"], { filename: 2 });
    for (const chunk of chunks) {
        index.add(chunk.id, { text: chunk.text, filename: chunk.filename });
    }
    return index.searchAny(query, chunks.length).map((hit) => hit.id);
};

/** Pick the evidence excerpts for the prompt, in priority order: chunks that
 *  contain a pinned quote (sentences the objective review verified against
 *  this evidence — proven relevant, so they beat any BM25 guess), then the
 *  best matches for the control text, until the character budget runs
 *  out. `ranked` (chunk ids of docs.flatMap(chunkDoc), best first) is the
 *  dense order from ai/retrieval.ts rankDraftChunks; without it, the
 *  order is BM25 for `query`. Purely retrieval-driven: document opening chunks get no special
 *  treatment, because they are mostly purpose/title boilerplate that
 *  crowded real implementation detail out of the budget. */
export const selectChunks = (
    docs: EvidenceDoc[],
    query: string,
    {
        budget = EVIDENCE_CHAR_BUDGET,
        pinnedQuotes = [] as string[],
        ranked: rankedIds = undefined as string[] | undefined,
    } = {},
): EvidenceChunk[] => {
    const chunks = docs.flatMap(chunkDoc);
    if (!chunks.length) {
        return [];
    }
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    const ranked = (rankedIds ?? bm25Ranking(chunks, query))
        .map((id) => byId.get(id)!)
        .filter(Boolean);

    const selected: EvidenceChunk[] = [];
    const perDoc = new Map<string, number>();
    let used = 0;
    const take = (chunk: EvidenceChunk): boolean => {
        if (selected.includes(chunk)) {
            return true;
        }
        if (used + chunk.text.length > budget) {
            return false;
        }
        if ((perDoc.get(chunk.evidenceId) ?? 0) >= MAX_CHUNKS_PER_DOC) {
            return true;
        }
        selected.push(chunk);
        perDoc.set(chunk.evidenceId, (perDoc.get(chunk.evidenceId) ?? 0) + 1);
        used += chunk.text.length;
        return true;
    };

    // Quote-bearing chunks first: the review already tied these passages to
    // the objective, so they must survive the budget cut.
    const quotes = pinnedQuotes.map(normalizeForMatch).filter(Boolean);
    if (quotes.length) {
        for (const chunk of chunks) {
            const haystack = normalizeForMatch(chunk.text);
            if (quotes.some((quote) => haystack.includes(quote))) {
                if (!take(chunk)) {
                    break;
                }
            }
        }
    }
    for (const chunk of ranked) {
        if (!take(chunk)) {
            break;
        }
    }
    // Stable presentation: group by document, in original document order.
    return selected.sort(
        (a, b) =>
            docs.findIndex((doc) => doc.evidenceId === a.evidenceId) -
                docs.findIndex((doc) => doc.evidenceId === b.evidenceId) ||
            a.seq - b.seq,
    );
};

export interface SummarizeInput {
    requirementId: string;
    title: string;
    /** The requirement statement (with any sub-statement text). */
    statement: string;
    /** Assessment objective prose, when the revision has it. */
    objectives: string[];
    chunks: EvidenceChunk[];
    /** Map-reduce document summaries (llm/summarize.ts): whole-document
     *  context the excerpts alone cannot carry. */
    overviews?: { filename: string; summary: string }[];
    /** Stored objective-review verdicts to ground the draft in. */
    findings?: ReviewFinding[];
    /** Sub-statement id when the draft targets one control (e.g.
     *  "03.01.01.a") instead of the whole requirement. */
    focusId?: string;
}

/** The retrieval query: control title + statement + objectives. */
export const summarizeQuery = (
    input: Pick<SummarizeInput, "title" | "statement" | "objectives">,
): string =>
    [input.title, input.statement, ...input.objectives].join(" ");

export const buildMessages = (input: SummarizeInput): ChatMessage[] => {
    const objectives = input.objectives.length
        ? `\n${input.objectives
              .map((objective) => `- ${objective}`)
              .join("\n")}\n`
        : "";
    // Review findings are secondary grounding: verdicts and reasons steer
    // what the narrative claims (and what lands under "Gaps:"), and each
    // verified quote points at the excerpt that proves it.
    const findings = input.findings?.length
        ? `\nPrior evidence-review findings (one per objective, from the same excerpts):\n${input.findings
              .map(
                  (finding) =>
                      `- ${finding.citation}: ${finding.verdict}` +
                      (finding.reason ? ` — ${finding.reason}` : "") +
                      (finding.quote?.verified
                          ? `\n  Supporting quote: "${finding.quote.text}" [${finding.quote.filename}]`
                          : ""),
              )
              .join("\n")}\n`
        : "";
    // Cap each overview so a rambling reduce cannot crowd out the excerpts;
    // the worker's input trim is the backstop.
    const overviews = input.overviews?.length
        ? `\nDocument summaries (context — cite details from the excerpts, not from here):\n${input.overviews
              .map(
                  (overview) =>
                      `- ${overview.filename}: ${overview.summary.slice(0, 400)}`,
              )
              .join("\n")}\n`
        : "";
    const excerpts = input.chunks
        .map((chunk) => `--- [${chunk.filename}] (excerpt)\n${chunk.text}`)
        .join("\n");
    // Prompt shape tuned for small local models, after five rounds of
    // iteration against real 1B output. Division of labor: the model writes
    // ONLY grounded prose. Citations, the gaps list, and the source list are
    // appended by the app (draft_panel.tsx) from the review findings and the
    // selected excerpts — every attempt to make the model produce them cost
    // something else (dropped citations, invented page numbers, gaps holding
    // implementation details, the gaps section truncated away entirely).
    // The objectives stay fenced off as a checklist because their ready-made
    // compliance phrasing is what the model parrots instead of reading the
    // excerpts, and the output contract is a skeleton plus a short form-only
    // example — a small model imitates an example far more reliably than it
    // obeys prohibitions.
    return [
        {
            role: "system",
            content:
                "You draft implementation narratives for NIST SP 800-171 / CMMC self-assessments. You describe, in present tense, what the organization does today, using only concrete details found in the evidence excerpts: their specific system names, tool names, policy titles, settings, and frequencies. The subject of your sentences is the organization, by the name the excerpts use — or \"The organization\" if they never name it. Never write \"they\" or \"the company\" for it. If the excerpts do not show something, leave it out — never speculate, never write generic compliance language, and never mention requirements, objectives, or assessments.",
        },
        {
            role: "user",
            content: `Context — reference material only; do not repeat any of it in your response.

Requirement ${input.requirementId} — ${input.title}
${input.statement}
${objectives ? `\nAssessment objectives (a coverage checklist — do NOT copy their wording):${objectives}` : ""}${findings}${overviews}
Evidence excerpts:
${excerpts}

Task: in at most ${input.focusId ? "120" : "200"} words, describe what the organization does to meet ${input.focusId ? `statement ${input.focusId}` : "this requirement"}, using only details from the excerpts.${input.findings?.some((finding) => finding.quote?.verified) ? " Build the description around the supporting quotes in the review findings." : ""} One or two short paragraphs of plain prose — no title, no headings, no lists, no citations, no summary sentence.

Example response (form only — never copy its words):
The organization issues staff standard user accounts for day-to-day applications; separate admin accounts exist for its four IT administrators only. Its help desk reviews role assignments quarterly and removes unused accounts within 30 days.

Write your response now.`,
        },
    ];
};
