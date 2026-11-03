"use client";
// Main-thread side of the local inference runtime: worker lifecycle and a
// status store for React. Lazy singleton, following utils/pdf.ts — nothing
// loads until the feature is first used.
//
// Bundled weights are a build-time input (flake.nix for the Nix desktop
// package, scripts/fetch-model-weights.mjs for non-Nix desktop builds);
// installers carry no model weights. Desktop builds can add a pinned
// model through the verified store (model_store.rs: explicit download or
// offline import, sha256-checked) — this module never fetches anything
// itself and just probes for whichever weights exist.

import { registerLocalModel } from "@/app/ai/model";
import { aiDebugLog, isTauri, readModelFile } from "@/app/utils/tauri";
import {
    CONTEXT_TOKENS,
    LlmDevice,
    LlmModel,
    MAX_NEW_TOKENS,
    contextTokensFor,
    externalDataChunks,
    hasBundledWeights,
    logitBytesPerToken,
    usableDevice,
} from "./config";
import { getDeviceCapabilities } from "./capabilities";
import { NativeWorker, WorkerLike } from "./native_worker";
import type { ChatMessage, FromWorker, ToWorker } from "./protocol";

/** Where this build keeps the weights: "origin" = fetchable from the app's
 *  own origin (dev server serving public/models); "ipc" = Tauri bundle
 *  resources, read through read_model_file; null = not in this build. */
type WeightSource = "origin" | "ipc" | null;

const resolveWeightSource = async (model: LlmModel): Promise<WeightSource> => {
    if (model.format === "gguf") {
        // GGUF weights are desktop resources the Rust engine reads
        // directly; probe a 64-byte slice over the same IPC command the
        // ONNX path uses (the file is gigabytes — never read it whole).
        const path = model.files[0]?.path;
        return path &&
            isTauri() &&
            (await readModelFile(`${model.repo}/${path}`, 0, 64))
            ? "ipc"
            : null;
    }
    if (await hasBundledWeights(model)) {
        return "origin";
    }
    if (isTauri() && (await readModelFile(`${model.repo}/config.json`))) {
        return "ipc";
    }
    return null;
};

/** True when this build ships the model's weights (either form). */
export const weightsAvailable = async (model: LlmModel): Promise<boolean> =>
    (await resolveWeightSource(model)) !== null;

/** Window of the loaded model (CONTEXT_TOKENS before any load). Prompt
 *  builders that budget outside the LocalModel adapter (the draft panel)
 *  read it to size their evidence budget to the device. */
export const getContextTokens = (): number => activeContextTokens;

export type LlmPhase = "idle" | "loading" | "ready" | "generating" | "error";

export interface LlmStatus {
    phase: LlmPhase;
    modelId?: string;
    device?: LlmDevice;
    /** 0..1 while the model initializes. */
    progress?: number;
    error?: string;
}

export interface GenerateHandle {
    /** Resolves with the full text once generation finishes or is stopped. */
    result: Promise<{ text: string; stats: { tokens: number; ms: number } }>;
    abort(): void;
}

type Listener = (status: LlmStatus) => void;

let status: LlmStatus = { phase: "idle" };
const listeners = new Set<Listener>();

const setStatus = (next: LlmStatus) => {
    status = next;
    listeners.forEach((listener) => listener(status));
};

export const getLlmStatus = (): LlmStatus => status;

export const subscribeLlmStatus = (listener: Listener): (() => void) => {
    listeners.add(listener);
    listener(status);
    return () => {
        listeners.delete(listener);
    };
};

let worker: WorkerLike | undefined;
/** Device the current model resolved to; picks the transport in getWorker
 *  ("native" = NativeWorker over Tauri IPC, else the in-webview Worker). */
let activeDevice: LlmDevice | undefined;
let loadedModelId: string | undefined;
let loadPromise: Promise<void> | undefined;
let requestCounter = 0;
let activeGeneration = false;
/** Model being served to the worker — read-file requests resolve against
 *  its manifest entry (paths, sizes for progress). */
let currentModel: LlmModel | undefined;
let ipcReadBytes = 0;
/** Window for the loaded model on this device (config.ts contextTokensFor):
 *  the CONTEXT_TOKENS floor, raised when the WebGPU adapter's buffer limit
 *  has room for the larger prefill logits tensor. Set by ensureLoaded. */
let activeContextTokens = CONTEXT_TOKENS;

// Weight files cross the IPC bridge in bounded slices: webviews cap (or
// crash on) very large single messages, and slicing also gives real
// progress on the multi-hundred-MB shards. 32 MB binary is ~43 MB as the
// base64 the bridge actually carries — inside the envelope the app's
// exports already proved out.
const IPC_CHUNK_BYTES = 32 * 1024 * 1024;

/** Read a resource file over IPC, chunked when the manifest knows it is
 *  large. onChunk reports bytes as they arrive (for progress). */
const readResourceFile = async (
    repo: string,
    path: string,
    size: number | undefined,
    onChunk: (bytes: number) => void,
): Promise<ArrayBuffer | null> => {
    if (!size || size <= IPC_CHUNK_BYTES) {
        const data = await readModelFile(`${repo}/${path}`);
        if (data) {
            onChunk(data.byteLength);
        }
        return data;
    }
    const assembled = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += IPC_CHUNK_BYTES) {
        const len = Math.min(IPC_CHUNK_BYTES, size - offset);
        const part = await readModelFile(`${repo}/${path}`, offset, len);
        if (!part || part.byteLength !== len) {
            aiDebugLog(
                `engine: chunk read failed ${path} @${offset} (${part?.byteLength ?? "null"}/${len})`,
            );
            return null;
        }
        assembled.set(new Uint8Array(part), offset);
        onChunk(len);
    }
    return assembled.buffer;
};

/** Drop the worker and every handle to it. The next ensureLoaded starts a
 *  fresh worker and reloads the model from scratch. */
const disposeWorker = () => {
    worker?.terminate();
    worker = undefined;
    activeDevice = undefined;
    loadedModelId = undefined;
    currentModel = undefined;
    loadPromise = undefined;
    activeContextTokens = CONTEXT_TOKENS;
    // Settle every request still waiting on the dead worker. Nothing will
    // ever answer them, and one unsettled request pins activeGeneration
    // true, which blocks all future runs until a page reload.
    const failure = new Error("The model worker was shut down.");
    pending.forEach((request) => request.reject(failure));
    pending.clear();
    activeGeneration = false;
    registerLocalModel(undefined);
};

interface PendingRequest {
    onToken: (text: string) => void;
    resolve: (value: {
        text: string;
        stats: { tokens: number; ms: number };
    }) => void;
    reject: (reason: Error) => void;
}
const pending = new Map<number, PendingRequest>();
let onWorkerReady: (() => void) | undefined;
let onWorkerLoadError: ((error: Error) => void) | undefined;

const getWorker = (): WorkerLike => {
    if (!worker) {
        worker =
            activeDevice === "native" && currentModel
                ? new NativeWorker(currentModel, activeContextTokens)
                : new Worker(new URL("./worker.ts", import.meta.url), {
                      type: "module",
                  });
        // Fires when the worker script itself dies (load failure, uncaught
        // throw) — distinct from a whole-web-process crash, which kills this
        // handler too. Either way the breadcrumb trail on stderr tells the
        // two apart: script death logs here; process death just stops.
        // A dead script answers nothing, so treat it like a fatal generate
        // error: tear the worker down and settle whoever is waiting, instead
        // of leaving the engine wedged behind an in-flight request.
        worker.onerror = (event) => {
            aiDebugLog(
                `worker onerror: ${event.message ?? "?"} @ ${event.filename ?? "?"}:${event.lineno ?? "?"}`,
            );
            const error = new Error(
                event.message || "The model worker crashed.",
            );
            const failedModelId = loadedModelId;
            const rejectLoad = onWorkerLoadError;
            disposeWorker();
            if (rejectLoad) {
                // Mid-load crash: fail the ensureLoaded promise (this also
                // sets the error status).
                rejectLoad(error);
            } else {
                setStatus({
                    phase: "error",
                    modelId: failedModelId,
                    device: status.device,
                    error: error.message,
                });
            }
        };
        worker.onmessage = (event: MessageEvent<FromWorker>) => {
            const message = event.data;
            switch (message.type) {
                case "log": {
                    aiDebugLog(message.message);
                    break;
                }
                case "read-file": {
                    // Desktop ipc mode: stream one weight file to the worker.
                    // The buffer is transferred (zero-copy) and nothing is
                    // retained here, so peak memory stays at a single file.
                    (async () => {
                        const model = currentModel;
                        // Serve any path under the model's resource dir (the
                        // Rust command confines it) — transformers.js probes
                        // optional files beyond the manifest. Only manifest
                        // entries count toward progress.
                        const known = model?.files.find(
                            (file) => file.path === message.path,
                        );
                        const data = model
                            ? await readResourceFile(
                                  model.repo,
                                  message.path,
                                  known?.size,
                                  (bytes) => {
                                      if (!known) {
                                          return;
                                      }
                                      ipcReadBytes += bytes;
                                      setStatus({
                                          phase: "loading",
                                          modelId: loadedModelId,
                                          device: status.device,
                                          progress: model.totalBytes
                                              ? Math.min(
                                                    1,
                                                    ipcReadBytes /
                                                        model.totalBytes,
                                                )
                                              : undefined,
                                      });
                                  },
                              )
                            : null;
                        aiDebugLog(
                            `engine: read ${message.path} -> ${data ? data.byteLength : "null"} bytes`,
                        );
                        send(
                            {
                                type: "file-data",
                                fileId: message.fileId,
                                data,
                            },
                            data ? [data] : [],
                        );
                    })();
                    break;
                }
                case "progress": {
                    setStatus({
                        phase: "loading",
                        modelId: loadedModelId,
                        progress: message.total
                            ? message.loaded / message.total
                            : undefined,
                    });
                    break;
                }
                case "ready": {
                    aiDebugLog("engine: worker reports ready");
                    onWorkerReady?.();
                    break;
                }
                case "token": {
                    pending.get(message.requestId)?.onToken(message.text);
                    break;
                }
                case "done": {
                    const request = pending.get(message.requestId);
                    pending.delete(message.requestId);
                    activeGeneration = false;
                    setStatus({
                        phase: "ready",
                        modelId: loadedModelId,
                        device: status.device,
                    });
                    request?.resolve({
                        text: message.text,
                        stats: message.stats,
                    });
                    break;
                }
                case "error": {
                    aiDebugLog(`engine: worker error: ${message.message}`);
                    const error = new Error(message.message);
                    if (message.requestId !== undefined) {
                        const request = pending.get(message.requestId);
                        pending.delete(message.requestId);
                        activeGeneration = false;
                        if (message.fatal) {
                            // The session is poisoned (lost WebGPU device /
                            // failed OrtRun) — every later run on it would
                            // fail too. Discard the worker; the next use
                            // reloads the model into a fresh one.
                            const failedModelId = loadedModelId;
                            disposeWorker();
                            setStatus({
                                phase: "error",
                                modelId: failedModelId,
                                device: status.device,
                                error: message.message,
                            });
                        } else {
                            setStatus({
                                phase: "ready",
                                modelId: loadedModelId,
                                device: status.device,
                            });
                        }
                        request?.reject(error);
                    } else {
                        onWorkerLoadError?.(error);
                    }
                    break;
                }
            }
        };
    }
    return worker;
};

const send = (message: ToWorker, transfer: Transferable[] = []) =>
    getWorker().postMessage(message, transfer);

/** Tear down the worker and release the model's memory (GPU buffers, WASM
 *  heap, or the native llama context — NativeWorker.terminate sends
 *  native_unload). Pending generations reject and the LocalModel
 *  unregisters, which also halts an in-flight objective review at its next
 *  objective. Safe to call any time; the next ensureLoaded starts a fresh
 *  worker. Used when the user disables the AI features. */
export const unloadModel = (): void => {
    if (!worker) {
        return;
    }
    disposeWorker();
    setStatus({ phase: "idle" });
};

/** Load the model into the worker (idempotent). Requires the weights to
 *  exist locally — bundled under /models/, or added through the verified
 *  model store; this function never fetches them. */
export const ensureLoaded = async (model: LlmModel): Promise<void> => {
    if (loadedModelId === model.id) {
        return loadPromise;
    }
    if (worker) {
        // One model at a time: replacing means a fresh worker so the old
        // graph's memory is actually released.
        disposeWorker();
    }

    const capabilities = await getDeviceCapabilities();
    // The effective device can differ from the probe: a WebGPU adapter
    // whose buffer limit cannot fit a working window sends WASM-capable
    // models to WASM and rejects WebGPU-only models.
    const device = usableDevice(model, capabilities);
    if (!device) {
        throw new Error(
            capabilities.device === "webgpu"
                ? `${model.label} needs more GPU memory than this device provides.`
                : `${model.label} needs WebGPU, which this browser does not provide.`,
        );
    }
    const source = await resolveWeightSource(model);
    activeContextTokens = contextTokensFor(model, {
        ...capabilities,
        device,
    });
    // Size breadcrumb for OOM reports. The logits/buffer numbers only mean
    // anything on WebGPU (the prefill logits tensor is a GPU buffer there);
    // WASM and native loads log the window alone.
    const inputBudget = activeContextTokens - MAX_NEW_TOKENS;
    const limits = capabilities.bufferLimits;
    const webgpuSizes =
        device === "webgpu"
            ? ` (input ${inputBudget}, max prefill logits ~${Math.round(
                  (inputBudget * logitBytesPerToken(model)) / 2 ** 20,
              )} MiB) ` +
              `maxBufferSize=${limits?.maxBufferSize ?? "?"} ` +
              `maxStorageBufferBindingSize=${limits?.maxStorageBufferBindingSize ?? "?"}`
            : "";
    aiDebugLog(
        `engine: ensureLoaded ${model.id} device=${device}` +
            (device === capabilities.device
                ? ""
                : ` (probe said ${capabilities.device})`) +
            ` source=${source} context=${activeContextTokens}${webgpuSizes}`,
    );
    if (!source) {
        throw new Error(
            `${model.label} is not included in this build. Desktop builds bundle the weights; see docs/local-ai.md.`,
        );
    }

    loadedModelId = model.id;
    currentModel = model;
    activeDevice = device;
    ipcReadBytes = 0;
    setStatus({ phase: "loading", modelId: model.id, device, progress: 0 });

    loadPromise = new Promise<void>((resolve, reject) => {
        onWorkerReady = () => {
            onWorkerReady = undefined;
            onWorkerLoadError = undefined;
            setStatus({ phase: "ready", modelId: model.id, device });
            registerLocalModel(makeLocalModel(model));
            resolve();
        };
        onWorkerLoadError = (error) => {
            onWorkerReady = undefined;
            onWorkerLoadError = undefined;
            loadedModelId = undefined;
            setStatus({
                phase: "error",
                modelId: model.id,
                error: error.message,
            });
            reject(error);
        };
        send({
            type: "load",
            repo: model.repo,
            revision: model.revision,
            dtype: model.dtype,
            device,
            externalDataChunks: externalDataChunks(model),
            ipc: source === "ipc",
        });
    });
    return loadPromise;
};

/** Stream a chat completion. One generation at a time — the worker is a
 *  single model instance and interleaved streams would corrupt both. */
export const generate = (
    messages: ChatMessage[],
    onToken: (text: string) => void,
    { maxNewTokens = MAX_NEW_TOKENS }: { maxNewTokens?: number } = {},
): GenerateHandle => {
    if (!loadedModelId) {
        throw new Error("No model loaded");
    }
    if (activeGeneration) {
        throw new Error("A generation is already running");
    }
    activeGeneration = true;
    const requestId = ++requestCounter;
    setStatus({
        phase: "generating",
        modelId: loadedModelId,
        device: status.device,
    });
    const result = new Promise<{
        text: string;
        stats: { tokens: number; ms: number };
    }>((resolve, reject) => {
        pending.set(requestId, { onToken, resolve, reject });
    });
    send({
        type: "generate",
        requestId,
        messages,
        maxNewTokens,
        contextTokens: activeContextTokens,
    });
    return {
        result,
        abort: () => send({ type: "abort", requestId }),
    };
};

// Adapter satisfying the LocalModel contract (docs/rag-review-plan.md): a
// single prompt string in, an async token stream out. The chat template is
// applied worker-side, so the plain prompt becomes one user turn.
const makeLocalModel = (model: LlmModel) => ({
    id: `${model.id}@${model.revision.slice(0, 12)}`,
    contextTokens: activeContextTokens,
    async *generate(
        prompt: string,
        opts?: { signal?: AbortSignal; maxNewTokens?: number },
    ) {
        const queue: string[] = [];
        let notify: (() => void) | undefined;
        let finished = false;
        let failure: Error | undefined;
        const handle = generate(
            [{ role: "user", content: prompt }],
            (text) => {
                queue.push(text);
                notify?.();
            },
            { maxNewTokens: opts?.maxNewTokens },
        );
        opts?.signal?.addEventListener("abort", () => handle.abort(), {
            once: true,
        });
        handle.result
            .catch((error: Error) => {
                failure = error;
            })
            .finally(() => {
                finished = true;
                notify?.();
            });
        for (;;) {
            while (queue.length) {
                yield queue.shift()!;
            }
            if (finished) {
                if (failure) {
                    throw failure;
                }
                return;
            }
            await new Promise<void>((resolve) => {
                notify = resolve;
            });
            notify = undefined;
        }
    },
});
