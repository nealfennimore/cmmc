"use client";
// Background reconciler that embeds every readable evidence document, so
// a review or a draft only embeds its query (docs/embedding-retrieval-plan.md).
// A sibling of summary_sync.ts, but simpler: an embedding costs
// milliseconds per chunk, it runs in its own WASM worker, and a changed
// LLM never makes a vector stale. Only a new embedder id or new chunk
// text does, and both give a new key in the chunk_vectors store.
//
// Both chunkings are embedded: chunkText (review retrieval) and chunkDoc
// (draft excerpts). The vector key is the text hash, so the two share rows
// wherever their chunks are identical.

import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { chunkText } from "@/app/ai/chunker";
import { ensureEvidenceTextSynced } from "@/app/search/evidence_text_store";
import { FREE_TIER } from "@/app/utils/tier";
import { embedPassages, embedderAvailable } from "./embedder";
import { getLlmStatus, subscribeLlmStatus } from "./engine";
import { chunkDoc } from "./prompt";
import { isAiEnabled } from "./settings";

export interface EmbedSyncState {
    phase: "idle" | "running";
    fileDone: number;
    fileTotal: number;
}

const IDLE: EmbedSyncState = { phase: "idle", fileDone: 0, fileTotal: 0 };
let state: EmbedSyncState = IDLE;
const listeners = new Set<(state: EmbedSyncState) => void>();

const setState = (next: EmbedSyncState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
};

export const getEmbedSync = (): EmbedSyncState => state;

export const subscribeEmbedSync = (
    listener: (state: EmbedSyncState) => void,
): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

let cancelled = false;
let currentAbort: AbortController | null = null;

/** Stop the pass. The next trigger starts a new one. */
export const cancelEmbedSync = (): void => {
    cancelled = true;
    rerun = false;
    currentAbort?.abort();
};

/** The embedder and a WASM LLM share the CPU. Wait while the LLM
 *  generates or loads, so background work never slows interactive work. */
const waitForLlm = async (): Promise<void> => {
    const busy = () => {
        const { phase } = getLlmStatus();
        return phase === "generating" || phase === "loading";
    };
    while (!cancelled && busy()) {
        await new Promise<void>((resolve) => {
            const unsubscribe = subscribeLlmStatus(() => {
                if (!busy()) {
                    queueMicrotask(() => unsubscribe());
                    resolve();
                }
            });
        });
    }
};

const reconcile = async (): Promise<void> => {
    if (FREE_TIER || !isAiEnabled() || !(await embedderAvailable())) {
        setState(IDLE);
        return;
    }
    await ensureEvidenceTextSynced();

    // Orphan cleanup: vectors whose evidence is gone.
    const evidenceIds = new Set((await IDB.evidence.getAllKeys()) as string[]);
    for (const row of await IDB.chunkVectors.getAll()) {
        if (!evidenceIds.has(row.evidence_id)) {
            await IDB.chunkVectors.delete(row.key);
        }
    }

    const texts = (await IDB.evidenceText.getAll()).filter(
        (row) =>
            row.status === "ok" && row.text.trim() && evidenceIds.has(row.id),
    );
    let fileDone = 0;
    for (const row of texts) {
        await waitForLlm();
        if (cancelled || !isAiEnabled()) {
            break;
        }
        setState({ phase: "running", fileDone, fileTotal: texts.length });
        const [meta] = await IDB.evidence.getAll(IDBKeyRange.only(row.id));
        const doc = {
            evidenceId: row.id,
            filename: meta?.filename ?? "",
            text: row.text,
        };
        const passages = [
            ...chunkText(doc.evidenceId, doc.text),
            ...chunkDoc(doc),
        ].map((chunk) => ({ evidenceId: doc.evidenceId, text: chunk.text }));
        const aborter = new AbortController();
        currentAbort = aborter;
        try {
            // Stored vectors are skipped inside embedPassages, so an
            // up-to-date file costs only the hashing and one read.
            if (!(await embedPassages(passages, aborter.signal))) {
                break; // the embedder failed: BM25 only from here on
            }
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.error("Evidence embedding failed", error);
            }
            break;
        } finally {
            currentAbort = null;
        }
        fileDone++;
    }
    setState(IDLE);
};

let inFlight: Promise<void> | undefined;
let rerun = false;

/** Run a pass. Calls during a pass trigger one follow-up pass. */
export const ensureEmbedSynced = (): Promise<void> => {
    if (inFlight) {
        rerun = true;
        return inFlight;
    }
    cancelled = false;
    inFlight = reconcile()
        .catch((error) => console.error("Evidence embedding failed", error))
        .finally(() => {
            inFlight = undefined;
            if (rerun) {
                rerun = false;
                void ensureEmbedSynced();
            }
        });
    return inFlight;
};

let started = false;

/** Idempotent starter: one deferred startup pass, and a new pass after new
 *  extracted text lands. Only evidenceText writes trigger it, and this
 *  module writes only chunkVectors, so it cannot trigger itself. */
export const startEmbedSync = (): void => {
    if (started || FREE_TIER || typeof window === "undefined") {
        return;
    }
    started = true;
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => void ensureEmbedSynced());
    } else {
        window.setTimeout(() => void ensureEmbedSynced(), 2000);
    }
    let debounce: number | undefined;
    window.addEventListener(TABLE_CHANGED_EVENT, (event) => {
        const detail = (event as CustomEvent<{ table?: string }>).detail;
        if (detail?.table !== IDB.evidenceText.table) {
            return;
        }
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void ensureEmbedSynced(), 1000);
    });
};
