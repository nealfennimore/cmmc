// Retrieval over the chunks of one requirement's evidence. With the
// embedder, chunks rank by embedding similarity (dense). Without it, they
// rank by BM25, which is the fallback. Dense only, not a fusion with BM25:
// on the retrieval eval, every fused variant ranked below dense alone
// (docs/embedding-retrieval-plan.md, "Eval results"). The BM25 index is
// built once per review run and shared by all of the requirement's
// objectives; searchAny (OR semantics) is required — the AND semantics of
// search() return zero chunks for a 30-word objective query.

import { embedPassages, embedQuery } from "@/app/llm/embedder";
import {
    EvidenceChunk as DraftChunk,
    EvidenceDoc,
    chunkDoc,
} from "@/app/llm/prompt";
import type { DocSummary } from "@/app/llm/summarize";
import { TextIndex } from "@/app/search/text_index";
import { chunkText } from "./chunker";
import { rankByVector } from "./hybrid";
import type { ReviewObjective } from "./objectives";

export interface RetrievedChunk {
    /** "{evidenceId}#{seq}" */
    id: string;
    evidenceId: string;
    seq: number;
    text: string;
    filename: string;
    score: number;
}

export interface ChunkIndex {
    index: TextIndex;
    chunksById: Map<string, Omit<RetrievedChunk, "score">>;
    /** Summary index doc id ("s:{evidenceId}#{seq}") -> the raw chunk id its
     *  score transfers to. Summary hits never enter the prompt themselves —
     *  only verbatim text is quotable. */
    summaryTargets: Map<string, string>;
    /** Chunk vectors, loaded once per index on the first dense query.
     *  Resolves to undefined when retrieval is BM25 only. */
    vectors?: Promise<{ id: string; vector: Float32Array }[] | undefined>;
}

const normalize = (text: string): string =>
    text.replace(/\s+/g, " ").trim().toLowerCase();

/** Chunk all texts and index them; milliseconds for a requirement's worth of
 *  evidence, so nothing is persisted. Stored chunk summaries (map step of
 *  llm/summarize.ts) are indexed as extra searchable docs: an objective can
 *  match a summary's vocabulary even when the raw text phrases it
 *  differently, and the hit boosts the raw chunk holding that content. */
export const buildChunkIndex = (
    docs: EvidenceDoc[],
    summaries: DocSummary[] = [],
): ChunkIndex => {
    const index = new TextIndex(["text", "filename"], { filename: 2 });
    const chunksById = new Map<string, Omit<RetrievedChunk, "score">>();
    for (const doc of docs) {
        for (const chunk of chunkText(doc.evidenceId, doc.text)) {
            chunksById.set(chunk.id, { ...chunk, filename: doc.filename });
            index.add(chunk.id, {
                text: chunk.text,
                filename: doc.filename,
            });
        }
    }

    // The summaries were produced over chunkDoc's chunking, which differs
    // from chunkText's. Bridge the two by locating each summarized chunk's
    // opening text inside this doc's raw chunks — both chunkings cover the
    // same extracted text, so the head appears in exactly one (or, with
    // overlap, two) of them.
    const summaryTargets = new Map<string, string>();
    for (const summary of summaries) {
        const doc = docs.find(
            (candidate) => candidate.evidenceId === summary.evidenceId,
        );
        if (!doc) {
            continue;
        }
        const rawChunks = [...chunksById.values()].filter(
            (chunk) => chunk.evidenceId === summary.evidenceId,
        );
        const sourceChunks = chunkDoc(doc);
        summary.chunkSummaries.forEach((chunkSummary, seq) => {
            const head = normalize(sourceChunks[seq]?.text ?? "").slice(
                0,
                120,
            );
            if (!head) {
                return;
            }
            const target = rawChunks.find((chunk) =>
                normalize(chunk.text).includes(head),
            );
            if (!target) {
                return;
            }
            const id = `s:${summary.evidenceId}#${seq}`;
            summaryTargets.set(id, target.id);
            index.add(id, { text: chunkSummary, filename: summary.filename });
        });
    }
    return { index, chunksById, summaryTargets };
};

/** Hook for a phase 3 cross-encoder that re-orders the candidates;
 *  identity until one is registered. */
export type Reranker = (
    objective: ReviewObjective,
    chunks: RetrievedChunk[],
) => Promise<RetrievedChunk[]>;

let reranker: Reranker | undefined;

export const setReranker = (next: Reranker | undefined): void => {
    reranker = next;
};

/** Chunk ids by similarity to the query text, or undefined when retrieval
 *  is BM25 only. Throws AbortError on abort. */
export const denseRank = async (
    queryText: string,
    chunkIndex: ChunkIndex,
    signal?: AbortSignal,
): Promise<string[] | undefined> => {
    chunkIndex.vectors ??= (async () => {
        const chunks = [...chunkIndex.chunksById.values()];
        const vectors = await embedPassages(chunks, signal);
        return vectors?.map((vector, index) => ({
            id: chunks[index].id,
            vector,
        }));
    })();
    let items: Awaited<ChunkIndex["vectors"]>;
    try {
        items = await chunkIndex.vectors;
    } catch (error) {
        // An aborted load must not stay cached for the next run.
        chunkIndex.vectors = undefined;
        throw error;
    }
    if (!items?.length) {
        return undefined;
    }
    const query = await embedQuery(queryText, signal);
    return query ? rankByVector(query, items) : undefined;
};

/** Best chunks for one objective, over-fetched to `limit * 2` so the prompt
 *  builder can drop chunks that do not fit the token budget. The order is
 *  dense when the embedder is available, else BM25. In the BM25 order,
 *  summary hits fold their score into the raw chunk they summarize, so the
 *  returned chunks are always verbatim text. */
export const retrieveForObjective = async (
    objective: ReviewObjective,
    chunkIndex: ChunkIndex,
    limit = 8,
    signal?: AbortSignal,
): Promise<RetrievedChunk[]> => {
    const { index, chunksById, summaryTargets } = chunkIndex;
    // The dense query is the objective and the requirement statement only.
    // The method terms and considerations are document names and question
    // lists: they dilute the meaning of one query vector.
    const dense = await denseRank(
        `${objective.text} ${objective.requirementStatement}`,
        chunkIndex,
        signal,
    );
    let ranked: [string, number][];
    if (dense) {
        // Score is only an order key downstream: 1 for the best chunk.
        ranked = dense.map((id, rank) => [id, 1 / (rank + 1)]);
    } else {
        // BM25 fallback, the same as before the embedder existed.
        // Over-fetch beyond the return cap: summary hits collapse onto raw
        // chunks, so distinct hits can merge.
        const query = [
            objective.text,
            objective.requirementStatement,
            ...objective.methodTerms,
            ...objective.considerations,
        ].join(" ");
        const scores = new Map<string, number>();
        for (const hit of index.searchAny(query, limit * 3)) {
            const id = summaryTargets.get(hit.id) ?? hit.id;
            scores.set(id, (scores.get(id) ?? 0) + hit.score);
        }
        ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    }
    const hits = ranked
        .slice(0, limit * 2)
        .map(([id, score]) => ({ ...chunksById.get(id)!, score }));
    return reranker ? reranker(objective, hits) : hits;
};

/** Dense order of the draft chunks (llm/prompt.ts chunkDoc) for
 *  selectChunks, or undefined when the embedder is not available
 *  (selectChunks then ranks with BM25 itself). The query is the control
 *  title and statement only, for the same reason as in
 *  retrieveForObjective. */
export const rankDraftChunks = async (
    chunks: DraftChunk[],
    denseQuery: string,
    signal?: AbortSignal,
): Promise<string[] | undefined> => {
    const vectors = await embedPassages(chunks, signal);
    if (!vectors?.length) {
        return undefined;
    }
    const query = await embedQuery(denseQuery, signal);
    if (!query) {
        return undefined;
    }
    return rankByVector(
        query,
        chunks.map((chunk, index) => ({ id: chunk.id, vector: vectors[index] })),
    );
};
