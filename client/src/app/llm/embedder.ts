"use client";
// Main-thread side of the retrieval embedder (docs/embedding-retrieval-plan.md):
// worker lifecycle, batching, and the vector cache. Lazy singleton, like
// engine.ts — nothing loads until the first embed call.
//
// Every failure degrades to "no embedder": the functions here then return
// undefined, and the callers rank with BM25 only. A failure never blocks a
// review or a draft. After a load or run error, a session flag keeps later
// calls from retrying a broken model.

import { IDB } from "@/app/db";
import { sha256Hex } from "@/app/utils/hash";
import { aiDebugLog, isTauri, readModelFile } from "@/app/utils/tauri";
import { FREE_TIER } from "@/app/utils/tier";
import { EMBEDDER, hasBundledWeights } from "./config";
import type { FromEmbedWorker, ToEmbedWorker } from "./embed_protocol";
import { readResourceFile } from "./engine";
import { isAiEnabled } from "./settings";

/** "unavailable": no pinned embedder in this build, or no weights.
 *  "failed": the worker failed to load or run in this session. */
export type EmbedderState =
    | "off"
    | "unavailable"
    | "idle"
    | "loading"
    | "ready"
    | "failed";

let state: EmbedderState = "idle";
const listeners = new Set<(state: EmbedderState) => void>();

const setState = (next: EmbedderState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
};

export const getEmbedderState = (): EmbedderState => state;

export const subscribeEmbedderState = (
    listener: (state: EmbedderState) => void,
): (() => void) => {
    listeners.add(listener);
    listener(state);
    return () => {
        listeners.delete(listener);
    };
};

/** Texts per worker request. Small batches keep each request short, so
 *  an abort takes effect between batches without a worker-side cancel. */
const BATCH_SIZE = 8;
/** In-memory vectors, about 1.5 KB each at 384 dimensions. */
const MEMORY_CACHE_LIMIT = 2000;

type WeightSource = "origin" | "ipc" | null;
let weightSource: Promise<WeightSource> | undefined;

/** Same probe order as engine.ts resolveWeightSource: same-origin
 *  /models/ (dev server), then Tauri bundle resources. Cached per session:
 *  the bundled weights do not change while the app runs. */
const resolveWeightSource = (): Promise<WeightSource> => {
    weightSource ??= (async () => {
        if (!EMBEDDER) {
            return null;
        }
        if (await hasBundledWeights(EMBEDDER)) {
            return "origin";
        }
        if (
            isTauri() &&
            (await readModelFile(`${EMBEDDER.repo}/config.json`))
        ) {
            return "ipc";
        }
        return null;
    })();
    return weightSource;
};

let failed = false;

const markFailed = (reason: string) => {
    aiDebugLog(`embedder: disabled for this session: ${reason}`);
    failed = true;
    disposeWorker(new Error(reason));
    setState("failed");
};

/** True when embedding retrieval can run now. Checks the AI toggle, the tier,
 *  the build, the weights, and the session failure flag. */
export const embedderAvailable = async (): Promise<boolean> => {
    if (FREE_TIER || !isAiEnabled()) {
        return false;
    }
    if (!EMBEDDER || failed) {
        return false;
    }
    if (!(await resolveWeightSource())) {
        setState("unavailable");
        return false;
    }
    return true;
};

/** The embedder id that the review fingerprint records, or undefined when
 *  retrieval is BM25 only. */
export const activeEmbedderId = async (): Promise<string | undefined> =>
    (await embedderAvailable()) ? EMBEDDER?.id : undefined;

/** Probe for the settings page, without a load. */
export const probeEmbedder = async (): Promise<EmbedderState> => {
    if (FREE_TIER || !isAiEnabled()) {
        return "off";
    }
    if (failed) {
        return "failed";
    }
    if (!EMBEDDER || !(await resolveWeightSource())) {
        return "unavailable";
    }
    return state === "unavailable" || state === "off" ? "idle" : state;
};

// ---------------------------------------------------------------------------
// Worker.

let worker: Worker | undefined;
let loadPromise: Promise<void> | undefined;
let requestCounter = 0;
const pending = new Map<
    number,
    { resolve: (rows: Float32Array[]) => void; reject: (error: Error) => void }
>();
let onReady: (() => void) | undefined;
let onLoadError: ((error: Error) => void) | undefined;

const send = (message: ToEmbedWorker, transfer: Transferable[] = []) =>
    worker?.postMessage(message, transfer);

const disposeWorker = (reason = new Error("The embedder was unloaded.")) => {
    worker?.terminate();
    worker = undefined;
    loadPromise = undefined;
    pending.forEach((request) => request.reject(reason));
    pending.clear();
    onLoadError?.(reason);
    onReady = undefined;
    onLoadError = undefined;
};

const handleMessage = (message: FromEmbedWorker) => {
    switch (message.type) {
        case "log":
            aiDebugLog(message.message);
            break;
        case "read-file": {
            const repo = EMBEDDER?.repo;
            const known = EMBEDDER?.files.find(
                (file) => file.path === message.path,
            );
            (async () => {
                const data = repo
                    ? await readResourceFile(
                          repo,
                          message.path,
                          known?.size,
                          () => {},
                      )
                    : null;
                send(
                    { type: "file-data", fileId: message.fileId, data },
                    data ? [data] : [],
                );
            })();
            break;
        }
        case "ready":
            onReady?.();
            break;
        case "vectors": {
            const request = pending.get(message.requestId);
            pending.delete(message.requestId);
            const rows: Float32Array[] = [];
            for (
                let offset = 0;
                offset < message.data.length;
                offset += message.dims
            ) {
                rows.push(message.data.slice(offset, offset + message.dims));
            }
            request?.resolve(rows);
            break;
        }
        case "error": {
            const error = new Error(message.message);
            if (message.requestId !== undefined) {
                const request = pending.get(message.requestId);
                pending.delete(message.requestId);
                request?.reject(error);
            } else {
                onLoadError?.(error);
            }
            break;
        }
    }
};

const ensureLoaded = (source: Exclude<WeightSource, null>): Promise<void> => {
    if (loadPromise) {
        return loadPromise;
    }
    const embedder = EMBEDDER!;
    worker = new Worker(new URL("./embed_worker.ts", import.meta.url), {
        type: "module",
    });
    worker.onmessage = (event: MessageEvent<FromEmbedWorker>) =>
        handleMessage(event.data);
    worker.onerror = (event) =>
        markFailed(event.message || "The embed worker crashed.");
    setState("loading");
    loadPromise = new Promise<void>((resolve, reject) => {
        onReady = () => {
            onReady = undefined;
            onLoadError = undefined;
            setState("ready");
            resolve();
        };
        onLoadError = (error) => {
            onReady = undefined;
            onLoadError = undefined;
            reject(error);
        };
    });
    send({
        type: "load",
        repo: embedder.repo,
        revision: embedder.revision,
        dtype: embedder.dtype,
        ipc: source === "ipc",
    });
    return loadPromise;
};

const abortError = () => new DOMException("Aborted", "AbortError");

/** Embed texts in batches. Throws AbortError on abort. Returns undefined
 *  (and disables the embedder) on any other failure. */
const embedRaw = async (
    texts: string[],
    signal?: AbortSignal,
): Promise<Float32Array[] | undefined> => {
    const source = await resolveWeightSource();
    if (!source || !EMBEDDER) {
        return undefined;
    }
    try {
        await ensureLoaded(source);
        const rows: Float32Array[] = [];
        for (let start = 0; start < texts.length; start += BATCH_SIZE) {
            if (signal?.aborted) {
                throw abortError();
            }
            const requestId = ++requestCounter;
            const batch = new Promise<Float32Array[]>((resolve, reject) =>
                pending.set(requestId, { resolve, reject }),
            );
            send({
                type: "embed",
                requestId,
                texts: texts.slice(start, start + BATCH_SIZE),
                pooling: EMBEDDER.pooling,
            });
            rows.push(...(await batch));
        }
        return rows;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
        }
        if (!worker && !failed) {
            // unloadEmbedder ran mid-request (AI turned off): not a model
            // failure, so do not set the session flag.
            return undefined;
        }
        markFailed(error instanceof Error ? error.message : String(error));
        return undefined;
    }
};

// ---------------------------------------------------------------------------
// Vector cache: memory first, then the chunk_vectors store (passages only).

const memory = new Map<string, Float32Array>();

const remember = (key: string, vector: Float32Array) => {
    memory.delete(key);
    memory.set(key, vector);
    if (memory.size > MEMORY_CACHE_LIMIT) {
        memory.delete(memory.keys().next().value!);
    }
};

const recall = (key: string): Float32Array | undefined => {
    const vector = memory.get(key);
    if (vector) {
        remember(key, vector); // refresh the LRU position
    }
    return vector;
};

/** One query vector, or undefined when retrieval is BM25 only. */
export const embedQuery = async (
    text: string,
    signal?: AbortSignal,
): Promise<Float32Array | undefined> => {
    if (!(await embedderAvailable()) || !EMBEDDER) {
        return undefined;
    }
    const key = `q:${EMBEDDER.id}:${await sha256Hex(text)}`;
    const cached = recall(key);
    if (cached) {
        return cached;
    }
    const [vector] =
        (await embedRaw([`${EMBEDDER.queryPrefix}${text}`], signal)) ?? [];
    if (vector) {
        remember(key, vector);
    }
    return vector;
};

export interface PassageInput {
    evidenceId: string;
    text: string;
}

/** One vector per passage, in input order, or undefined when retrieval is
 *  BM25 only. Stored vectors are reused, and new ones are persisted, so
 *  each chunk text is embedded once per embedder. */
export const embedPassages = async (
    passages: PassageInput[],
    signal?: AbortSignal,
): Promise<Float32Array[] | undefined> => {
    if (!(await embedderAvailable()) || !EMBEDDER) {
        return undefined;
    }
    const embedder = EMBEDDER;
    const keys = await Promise.all(
        passages.map(
            async (passage) =>
                `${embedder.id}:${await sha256Hex(passage.text)}`,
        ),
    );
    const vectors: (Float32Array | undefined)[] = keys.map((key) =>
        recall(`p:${key}`),
    );

    // One indexed read per artifact instead of one per chunk.
    const missingIds = new Set(
        passages
            .filter((_, index) => !vectors[index])
            .map((passage) => passage.evidenceId),
    );
    if (missingIds.size) {
        const stored = new Map<string, Float32Array>();
        for (const evidenceId of missingIds) {
            for (const row of await IDB.chunkVectors.getAll(
                IDBKeyRange.only(evidenceId),
                "evidence_id",
            )) {
                stored.set(row.key, new Float32Array(row.vector));
            }
        }
        keys.forEach((key, index) => {
            const vector = vectors[index] ?? stored.get(key);
            if (vector) {
                vectors[index] = vector;
                remember(`p:${key}`, vector);
            }
        });
    }

    const todo = vectors
        .map((vector, index) => (vector ? -1 : index))
        .filter((index) => index >= 0);
    if (todo.length) {
        const fresh = await embedRaw(
            todo.map(
                (index) => `${embedder.passagePrefix}${passages[index].text}`,
            ),
            signal,
        );
        if (!fresh) {
            return undefined;
        }
        const created = Date.now();
        for (let i = 0; i < todo.length; i++) {
            const index = todo[i];
            vectors[index] = fresh[i];
            remember(`p:${keys[index]}`, fresh[i]);
            await IDB.chunkVectors.put({
                key: keys[index],
                evidence_id: passages[index].evidenceId,
                embedder: embedder.id,
                vector: fresh[i].slice().buffer,
                created,
            });
        }
    }
    return vectors as Float32Array[];
};

/** Stop the worker and free its memory. Call after the jobs that use it
 *  are cancelled (AI toggle off, model_settings.tsx). The session failure
 *  flag stays. */
export const unloadEmbedder = (): void => {
    disposeWorker();
    memory.clear();
    if (!failed) {
        setState(isAiEnabled() ? "idle" : "off");
    }
};
