// Orchestration for the per-objective evidence review: gather the
// requirement's evidence, retrieve chunks per objective, stream the model,
// parse, and persist one row per objective as it completes — so a stopped
// run keeps its finished rows and TABLE_CHANGED_EVENT updates the panel row
// by row.

import { Revision } from "@/app/context/revision";
import { IDB, IDBObjectiveReview } from "@/app/db";
import { getDeviceCapabilities } from "@/app/llm/capabilities";
import { resolveUsableModel } from "@/app/llm/config";
import { activeEmbedderId } from "@/app/llm/embedder";
import { EvidenceDoc, gatherEvidence } from "@/app/llm/prompt";
import {
    getSelectedModelId,
    isSummaryContextEnabled,
} from "@/app/llm/settings";
import { DocSummary, freshDocSummaries } from "@/app/llm/summarize";
import { pauseSummarySync } from "@/app/llm/summary_sync";
import { ensureEvidenceTextSynced } from "@/app/search/evidence_text_store";
import { EXTRACTOR_VERSION } from "@/app/search/extract_text";
import { sha256Hex } from "@/app/utils/hash";
import { CHUNKER_VERSION } from "./chunker";
import { getLocalModel } from "./model";
import { objectivesForRequirement } from "./objectives";
import {
    PROMPT_VERSION,
    buildReviewPrompt,
    parseReviewResponse,
} from "./prompt";
import { RETRIEVAL_VERSION } from "./hybrid";
import { buildChunkIndex, retrieveForObjective } from "./retrieval";

/** What a stored verdict depends on: the reviewed evidence set, every
 *  version in the pipeline, the document summaries that entered the
 *  prompt (a summary appearing or changing later must flag the row stale),
 *  and, with the embedder, the embedder id and RETRIEVAL_VERSION. A
 *  BM25-only run adds neither part, so its fingerprint is the same as
 *  before the embedder existed. A mismatch with the current state
 *  means the row is stale. */
export const reviewFingerprint = (
    evidenceIds: string[],
    modelId: string,
    summaryFingerprints: string[] = [],
    embedderId?: string,
): Promise<string> =>
    sha256Hex(
        [
            ...[...evidenceIds].sort(),
            ...[...summaryFingerprints].sort().map((fp) => `summary:${fp}`),
            `extractor:${EXTRACTOR_VERSION}`,
            `chunker:${CHUNKER_VERSION}`,
            `prompt:${PROMPT_VERSION}`,
            ...(embedderId
                ? [`retrieval:${RETRIEVAL_VERSION}`, `embedder:${embedderId}`]
                : []),
            `model:${modelId}`,
        ].join("\n"),
    );

/** The stored document summaries a review would use right now: none when
 *  the summary-context setting is off; else complete and fresh only, and
 *  never generated here — the draft flow owns creating
 *  them, so review latency stays predictable. Keyed by the manifest id of
 *  the model this device actually runs (the id the draft flow stamps them
 *  with — both sides resolve through resolveUsableModel). */
const storedSummaries = async (docs: EvidenceDoc[]): Promise<DocSummary[]> => {
    if (!isSummaryContextEnabled()) {
        return [];
    }
    const model = resolveUsableModel(
        getSelectedModelId(),
        await getDeviceCapabilities(),
    );
    return model ? freshDocSummaries(docs) : [];
};

export interface ExpectedReviewState {
    /** Fingerprint fresh reviews would carry now; undefined without a model. */
    fingerprint?: string;
    /** Linked artifacts with no extractable text (excluded from review). */
    unreadable: number;
}

/** The state the staleness check compares stored rows against. Reads the
 *  same evidence set a run would. */
export const expectedReviewState = async (
    requirementId: string,
): Promise<ExpectedReviewState> => {
    const model = getLocalModel();
    const { docs, unreadable } = await gatherEvidence(requirementId);
    const summaries = await storedSummaries(docs);
    return {
        fingerprint: model
            ? await reviewFingerprint(
                  docs.map((doc) => doc.evidenceId),
                  model.id,
                  summaries.map((summary) => summary.fingerprint),
                  await activeEmbedderId(),
              )
            : undefined,
        unreadable: unreadable.length,
    };
};

export interface ReviewProgress {
    done: number;
    total: number;
    unreadable: number;
}

export interface ReviewOptions {
    signal?: AbortSignal;
    onProgress?: (progress: ReviewProgress) => void;
}

// One run app-wide (the model is a single instance); a second call while one
// is running coalesces onto it, same idiom as evidence_text_store.ts.
let inFlight: Promise<void> | undefined;

/** Review every objective of a requirement against its linked evidence.
 *  Rows persist per objective; abort keeps the completed ones. */
export const reviewRequirement = (
    revision: Revision,
    requirementId: string,
    options: ReviewOptions = {},
): Promise<void> => {
    if (inFlight) {
        return inFlight;
    }
    inFlight = run(revision, requirementId, options).finally(() => {
        inFlight = undefined;
    });
    return inFlight;
};

const run = async (
    revision: Revision,
    requirementId: string,
    { signal, onProgress }: ReviewOptions,
): Promise<void> => {
    const model = getLocalModel();
    if (!model) {
        throw new Error("No local model is available.");
    }
    const objectives = objectivesForRequirement(revision, requirementId);
    if (!objectives.length) {
        return;
    }

    // Interactive work excludes the background summarizer for the whole
    // run — the idle gaps between per-objective generations must not be
    // filled by background chunks.
    const resume = await pauseSummarySync();
    try {
        await reviewObjectives(requirementId, objectives, model, {
            signal,
            onProgress,
        });
    } finally {
        resume();
    }
};

const reviewObjectives = async (
    requirementId: string,
    objectives: ReturnType<typeof objectivesForRequirement>,
    model: NonNullable<ReturnType<typeof getLocalModel>>,
    { signal, onProgress }: ReviewOptions,
): Promise<void> => {
    await ensureEvidenceTextSynced();
    const { docs, unreadable } = await gatherEvidence(requirementId);
    const progress: ReviewProgress = {
        done: 0,
        total: objectives.length,
        unreadable: unreadable.length,
    };
    onProgress?.({ ...progress });

    // Chunk and index once — all objectives of the requirement share it.
    // Stored chunk summaries join the index as retrieval vocabulary. The
    // chunk vectors load on the first objective and are shared too.
    const summaries = await storedSummaries(docs);
    const chunkIndex = buildChunkIndex(docs, summaries);
    const fingerprint = await reviewFingerprint(
        docs.map((doc) => doc.evidenceId),
        model.id,
        summaries.map((summary) => summary.fingerprint),
        await activeEmbedderId(),
    );

    // Sequential on purpose: one generation at a time is all the engine
    // allows, and each row lands as soon as its objective finishes.
    for (const objective of objectives) {
        if (signal?.aborted) {
            return;
        }
        let retrieved;
        try {
            retrieved = await retrieveForObjective(
                objective,
                chunkIndex,
                8,
                signal,
            );
        } catch (error) {
            if (signal?.aborted) {
                return;
            }
            throw error;
        }
        const { prompt, included } = buildReviewPrompt(
            objective,
            retrieved,
            model,
            summaries,
        );

        const row: IDBObjectiveReview = {
            objective_id: objective.id,
            requirement_id: requirementId,
            citation: objective.citation,
            verdict: "error",
            reason: "",
            raw: "",
            fingerprint,
            model: model.id,
            created: Date.now(),
        };
        try {
            let raw = "";
            // 320, not 256: the tagged format needs ~80 tokens, but when the
            // model drifts into prose despite the example, the extra room
            // lets the reason finish instead of cutting off mid-word.
            for await (const token of model.generate(prompt, {
                signal,
                maxNewTokens: 320,
            })) {
                raw += token;
            }
            // An abort makes generate() return early with partial text;
            // don't persist a half-formed verdict for this objective.
            if (signal?.aborted) {
                return;
            }
            const parsed = parseReviewResponse(raw, included);
            row.verdict = parsed.verdict;
            row.reason = parsed.reason;
            row.quote = parsed.quote;
            row.raw = raw;
        } catch (error) {
            if (signal?.aborted) {
                return;
            }
            // Keep the failure visible in the row and continue with the
            // remaining objectives.
            row.raw = error instanceof Error ? error.message : String(error);
            row.reason = `The review failed before reaching a verdict: ${row.raw}`;
        }
        await IDB.objectiveReviews.put(row);
        onProgress?.({ ...progress, done: ++progress.done });
        // A fatal engine failure (lost WebGPU device, failed OrtRun)
        // unregisters the model; without it every remaining objective would
        // fail identically. Surface the failure and stop instead.
        if (row.verdict === "error" && !getLocalModel()) {
            throw new Error(
                `Evidence review stopped — the model failed and was unloaded (${row.raw}). Run again to reload it.`,
            );
        }
    }
};
