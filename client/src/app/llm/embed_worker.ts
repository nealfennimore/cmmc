// Embedding Web Worker for embedding retrieval (docs/embedding-retrieval-plan.md).
// It runs the transformers.js feature-extraction pipeline on WASM only,
// with the plain (non-JSEP) ONNX Runtime build:
//   - it never takes WebGPU memory from the LLM (WebKitGTK gives the
//     WebGPU device only 1 GiB);
//   - the plain build is the one that works on JavaScriptCore;
//   - it also works on native desktop builds, where no LLM worker exists.
// Weights come only from the bundled /models/ tree or over Tauri IPC. The
// worker performs no network fetch.

import { env, pipeline } from "@huggingface/transformers";
import type { FromEmbedWorker, ToEmbedWorker } from "./embed_protocol";

const post = (message: FromEmbedWorker, transfer: Transferable[] = []) =>
    self.postMessage(message, { transfer });
const log = (message: string) => post({ type: "log", message: `embed: ${message}` });

// Same environment as worker.ts. localModelPath must stay relative (see
// the comment there). wasmPaths names the plain build explicitly: this
// worker never uses WebGPU.
env.backends.onnx.wasm!.wasmPaths = {
    mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", self.location.origin).href,
    wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", self.location.origin)
        .href,
};
env.localModelPath = "/models/";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;

type Extractor = Awaited<ReturnType<typeof pipeline<"feature-extraction">>>;

let loading: Promise<Extractor> | undefined;

let fileIdCounter = 0;
const pendingFiles = new Map<number, (data: ArrayBuffer | null) => void>();

const requestFile = (path: string): Promise<ArrayBuffer | null> =>
    new Promise((resolve) => {
        const fileId = ++fileIdCounter;
        pendingFiles.set(fileId, resolve);
        post({ type: "read-file", fileId, path });
    });

const load = async (
    message: Extract<ToEmbedWorker, { type: "load" }>,
): Promise<Extractor> => {
    log(`load: repo=${message.repo} dtype=${message.dtype} ipc=${!!message.ipc}`);
    if (message.ipc) {
        // The same custom-cache bridge as worker.ts: each file crosses the
        // IPC bridge on request, and the worker retains nothing.
        env.useCustomCache = true;
        env.customCache = {
            match: async (request: Request | string) => {
                const key = typeof request === "string" ? request : request.url;
                const marker = `${message.repo}/`;
                const index = key.lastIndexOf(marker);
                if (index === -1) {
                    return undefined;
                }
                const data = await requestFile(key.slice(index + marker.length));
                return data ? new Response(data) : undefined;
            },
            put: async () => {},
        };
    }
    const extractor = await pipeline("feature-extraction", message.repo, {
        revision: message.revision,
        dtype: message.dtype as "q8",
        device: "wasm",
    });
    log("load: session created");
    return extractor;
};

self.onmessage = async (event: MessageEvent<ToEmbedWorker>) => {
    const message = event.data;
    try {
        switch (message.type) {
            case "file-data": {
                const resolve = pendingFiles.get(message.fileId);
                pendingFiles.delete(message.fileId);
                resolve?.(message.data);
                break;
            }
            case "load": {
                loading ??= load(message);
                await loading;
                post({ type: "ready" });
                break;
            }
            case "embed": {
                if (!loading) {
                    throw new Error("Embedder not loaded");
                }
                const extractor = await loading;
                const output = await extractor(message.texts, {
                    pooling: message.pooling,
                    normalize: true,
                });
                // Copy before the transfer: the tensor can be a view into
                // a buffer that ONNX Runtime still owns.
                const data = new Float32Array(output.data as Float32Array);
                const dims = output.dims[output.dims.length - 1];
                post(
                    { type: "vectors", requestId: message.requestId, data, dims },
                    [data.buffer],
                );
                break;
            }
        }
    } catch (error) {
        if (message.type === "load") {
            loading = undefined;
        }
        post({
            type: "error",
            requestId: "requestId" in message ? message.requestId : undefined,
            message:
                typeof error === "number"
                    ? `ONNX Runtime error ${error}`
                    : error instanceof Error
                      ? error.message
                      : String(error),
        });
    }
};
