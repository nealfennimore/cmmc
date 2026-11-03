// Model registry for the local summarizer, built from the pinned manifest.
// The manifest (models.manifest.json) is the single source of truth shared
// with flake.nix (desktop weight bundling) and scripts/update-model-manifest.mjs
// (regeneration) — nothing here hardcodes a URL or hash.

import manifest from "./models.manifest.json";

/** Where a model runs: WebGPU or WASM inside the webview, or "native" —
 *  llama.cpp in the Rust process (desktop only), reached over Tauri IPC.
 *  The native path exists because Linux webkitgtk caps WebGPU below a
 *  usable window; see docs/native-inference-plan.md. */
export type LlmDevice = "webgpu" | "wasm" | "native";

export interface ManifestFile {
    path: string;
    url: string;
    size: number;
    sha256: string;
}

export interface LlmModel {
    id: string;
    label: string;
    repo: string;
    revision: string;
    /** transformers.js dtype key; also names the ONNX file
     *  (model_<dtype>.onnx). For format "gguf" it is the quantization name
     *  (for example Q4_K_M) and names the .gguf file instead. */
    dtype: string;
    /** "gguf" = single-file llama.cpp model for the native desktop path.
     *  Absent = ONNX for the in-webview runtime. */
    format?: string;
    /** Weakest device this model is usable on. "webgpu" bars slow WASM-only
     *  machines from a model that would generate at unusable speed. */
    minDevice: LlmDevice;
    /** Node process.platform values whose desktop bundles include the
     *  weights. Absent = all platforms. Runtime never reads this — missing
     *  weights are detected by probing (engine.ts resolveWeightSource);
     *  this field only drives build-time fetching. */
    bundlePlatforms?: string[];
    license: string;
    licenseNotice: string;
    licenseUrl: string;
    totalBytes: number;
    files: ManifestFile[];
}

export const MODELS: LlmModel[] = manifest.models;

/** The retrieval embedding model (manifest "embedders",
 *  docs/embedding-retrieval-plan.md). It runs in its own WASM-only worker
 *  (embed_worker.ts) and never appears in the LLM picker. */
export interface EmbedderModel {
    id: string;
    label: string;
    repo: string;
    revision: string;
    /** transformers.js dtype key; "q8" = onnx/model_quantized.onnx. */
    dtype: string;
    /** The source weights that models/embedder/export.sh converts. */
    upstream: string;
    upstreamRevision: string;
    pooling: "cls" | "mean";
    dimensions: number;
    /** Tokenizer truncation length for one text. */
    maxTokens: number;
    queryPrefix: string;
    passagePrefix: string;
    license: string;
    licenseUrl: string;
    totalBytes: number;
    files: ManifestFile[];
}

const EMBEDDERS = (manifest.embedders ?? []) as EmbedderModel[];

/** The first pinned embedder, or undefined when none is pinned yet — then
 *  retrieval is BM25 only. */
export const EMBEDDER: EmbedderModel | undefined = EMBEDDERS.find(
    (embedder) =>
        embedder.revision !== "" &&
        embedder.files.length > 0 &&
        embedder.files.every((file) => file.sha256 !== ""),
);

/** The CMMC fine-tune of Llama 3.2 1B (models/finetune/pipeline). The
 *  manifest holds no other model: the base Llamas and the Gemma 270M lite
 *  model were removed, so no WASM-capable model exists. */
export const DEFAULT_MODEL_ID = "llama-3.2-1b-instruct-cmmc";
/** First fallback on devices with the native path (Linux desktop): the 1B
 *  as a GGUF, tried before the ONNX default in resolveUsableModel. */
export const NATIVE_DEFAULT_MODEL_ID = "llama-3.2-1b-instruct-cmmc-gguf";

export const getModel = (id: string): LlmModel | undefined =>
    MODELS.find((model) => model.id === id);

/** A model is usable only once the manifest pins every file's sha256.
 *  Unpinned entries are placeholders awaiting update-model-manifest.mjs. */
export const isPinned = (model: LlmModel): boolean =>
    model.revision !== "" &&
    model.files.length > 0 &&
    model.files.every((file) => file.sha256 !== "");

/** How many external-data shards the ONNX graph references
 *  (onnx/model_<dtype>.onnx_data, _data_1, ...). ONNX Runtime cannot
 *  discover these in a browser — transformers.js must be told to fetch
 *  them, so the count is threaded into the worker's load options. Zero
 *  means the graph is self-contained. */
export const externalDataChunks = (model: LlmModel): number =>
    model.files.filter((file) => file.path.includes(".onnx_data")).length;


// Weights live in client/public/models/. The dev server serves them from
// the app origin at this path; production desktop builds instead strip them
// from the export (scripts/strip-model-assets.mjs — embedding gigabytes
// breaks rustc) and ship them as Tauri bundle resources read over IPC (see
// engine.ts resolveWeightSource). transformers.js still keys local files as
// `${localModelPath}${repo}/<file>`.
export const LOCAL_MODEL_PATH = "/models/";

/** True when the weights are fetchable from the app's own origin (dev
 *  server, or any hosting that serves public/models). Probes the smallest
 *  manifest file. Production desktop uses the IPC path instead. */
export const hasBundledWeights = async (
    model: Pick<LlmModel, "repo">,
): Promise<boolean> => {
    try {
        const response = await fetch(
            `${LOCAL_MODEL_PATH}${model.repo}/config.json`,
            { method: "GET", cache: "no-store" },
        );
        if (!response.ok) {
            return false;
        }
        // GitHub Pages serves an HTML 404 page for some paths with a 200-ish
        // custom setup; require JSON to count as a real bundled config.
        const text = await response.text();
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
};

// Generation budget. Both candidate models accept far larger windows, but
// the window caps KV-cache memory in the browser and keeps WASM latency
// tolerable. 2,560 (input <= 2,048 after the 512 output reserve) is a WebGPU
// memory bound, not a latency choice: prefill logits are sequence x vocab
// (~0.5 MB per input token on the 1B model), and near-4K prompts drove real
// devices out of GPU memory (webgpu_context "device error(3): Out of
// memory"). The worker enforces this by trimming input to
// contextTokens - MAX_NEW_TOKENS, so no prompt-builder mistake can exceed
// it.
//
// CONTEXT_TOKENS is the floor: every device that ran the model before ran
// it at this window. contextTokensFor raises it only when the adapter's
// reported buffer limit proves there is room for the larger logits tensor.
export const CONTEXT_TOKENS = 2560;
export const MAX_NEW_TOKENS = 512;
/** Ceiling for the adaptive window. Beyond this, prefill latency and the
 *  KV cache grow for little benefit — the prompt builders rarely have more
 *  than ~5K tokens of distinct evidence to offer. */
export const MAX_CONTEXT_TOKENS = 6144;

/** fp32 logit row per input token, from each repo's config.json vocab_size.
 *  Unknown ids get the larger vocab, which only under-sizes the window. */
const LOGIT_BYTES_PER_TOKEN: Record<string, number> = {
    "llama-3.2-1b-instruct-cmmc": 128256 * 4,
    "llama-3.2-3b-instruct-cmmc": 128256 * 4,
};
const FALLBACK_LOGIT_BYTES = 262144 * 4;
export const logitBytesPerToken = (model: LlmModel): number =>
    LOGIT_BYTES_PER_TOKEN[model.id] ?? FALLBACK_LOGIT_BYTES;
/** To RAISE the window past the floor, the logits tensor may claim at most
 *  1/3 of the largest allocatable buffer. The rest of the picture (weights
 *  ~1.1 GB, KV cache, activations) shares the same GPU memory, and the
 *  adapter limit is an upper bound on buffer size, not a free-memory
 *  report — near-4K prompts OOMed real devices, so the divisor errs
 *  conservative. Tune here if field results allow. */
const RAISE_HEADROOM_DIVISOR = 3;
/** To KEEP the floor, its logits must fit in 1/2 of the limit; adapters
 *  below that shrink to what 1/2 allows. Half, not a third, because the
 *  floor has field history: it ran on adapters whose limit gave its logits
 *  2x headroom. A 1 GiB adapter proved the need to shrink at all — its
 *  ~1002 MiB floor logits OOMed against a 1024 MiB max buffer. */
const SHRINK_HEADROOM_DIVISOR = 2;
/** Window below which the prompts stop working: 1,048 tokens of fixed
 *  overhead plus the 512 output reserve leave under ~500 tokens of
 *  evidence. usableDevice treats WebGPU windows below this as unusable
 *  rather than reviewing evidence it cannot see. */
export const MIN_CONTEXT_TOKENS = 2048;

const roundWindow = (inputTokens: number): number =>
    Math.floor((inputTokens + MAX_NEW_TOKENS) / 128) * 128;

/** Context window for this model on this device, in either direction from
 *  the floor. WASM (and adapters that report no limits) stay at the
 *  CONTEXT_TOKENS floor — the WASM path is latency-bound and 32-bit, so a
 *  larger window only buys slower prompts. On WebGPU the window grows with
 *  the adapter's buffer limit, or shrinks below the floor when the limit
 *  proves the floor cannot fit. The result can be under
 *  MIN_CONTEXT_TOKENS — callers gate through usableDevice. */
export const contextTokensFor = (
    model: LlmModel,
    capabilities: { device: LlmDevice; maxBufferBytes?: number },
): number => {
    if (capabilities.device === "native") {
        // No adapter-limit math applies: llama.cpp allocates from real
        // device memory, and the binding cost is the KV cache (~700 MB for
        // the 3B at this window), not a logits buffer. The cap doubles as
        // n_ctx.
        return MAX_CONTEXT_TOKENS;
    }
    if (capabilities.device !== "webgpu" || !capabilities.maxBufferBytes) {
        return CONTEXT_TOKENS;
    }
    const perToken = logitBytesPerToken(model);
    const raised = roundWindow(
        Math.floor(
            capabilities.maxBufferBytes / RAISE_HEADROOM_DIVISOR / perToken,
        ),
    );
    if (raised >= CONTEXT_TOKENS) {
        return Math.min(MAX_CONTEXT_TOKENS, raised);
    }
    const floorLogitBytes = (CONTEXT_TOKENS - MAX_NEW_TOKENS) * perToken;
    if (
        floorLogitBytes <=
        capabilities.maxBufferBytes / SHRINK_HEADROOM_DIVISOR
    ) {
        return CONTEXT_TOKENS;
    }
    return roundWindow(
        Math.floor(
            capabilities.maxBufferBytes / SHRINK_HEADROOM_DIVISOR / perToken,
        ),
    );
};

/** The device this model can run on here, or null when it cannot run at
 *  all. WebGPU counts only when its window still fits a working prompt;
 *  models that allow WASM fall back to it (CPU memory, no GPU buffer
 *  limits), and WebGPU-only models report unusable. The engine and the UI
 *  gates share this so they agree. */
export const usableDevice = (
    model: LlmModel,
    capabilities: {
        device: LlmDevice;
        maxBufferBytes?: number;
        native?: boolean;
    },
): LlmDevice | null => {
    if (model.minDevice === "native") {
        // GGUF models run only in the Rust process. llama.cpp's CPU
        // backend counts: it still beats WASM in the webview.
        return capabilities.native ? "native" : null;
    }
    if (
        capabilities.device === "webgpu" &&
        contextTokensFor(model, capabilities) >= MIN_CONTEXT_TOKENS
    ) {
        return "webgpu";
    }
    return model.minDevice === "wasm" ? "wasm" : null;
};

/** The model this device will actually run: the user's selection when it
 *  is pinned and usable here, else the native 1B (Linux desktop), else the
 *  default model. Null when nothing fits —
 *  only then do the AI features hide. The stored preference is never
 *  rewritten, so a later session on stronger hardware honors it again.
 *  Every feature gate and load path must resolve through this, or a
 *  device that cannot run the selected model loses the feature instead of
 *  falling back. */
export const resolveUsableModel = (
    selectedId: string,
    capabilities: {
        device: LlmDevice;
        maxBufferBytes?: number;
        native?: boolean;
    },
): LlmModel | null => {
    for (const id of [
        selectedId,
        NATIVE_DEFAULT_MODEL_ID,
        DEFAULT_MODEL_ID,
    ]) {
        const model = getModel(id);
        if (model && isPinned(model) && usableDevice(model, capabilities)) {
            return model;
        }
    }
    return null;
};
/** Output budget for the draft narrative. The model writes ~120 words of
 *  prose (the app appends gaps and sources itself); a short leash also cuts
 *  the meta-openers and summary paragraphs the 1B model pads with when it
 *  has room. */
export const DRAFT_MAX_NEW_TOKENS = 300;
/** Conservative chars-per-token estimate for budget math done outside the
 *  tokenizer; the worker re-checks with the real tokenizer and trims. */
export const CHARS_PER_TOKEN = 4;
/** Fixed prompt overhead around the evidence excerpts: instructions ~250,
 *  control and objectives ~600, and review findings ~200. */
const PROMPT_OVERHEAD_TOKENS = 1048;
/** Token budget for evidence excerpts: what the input budget of the given
 *  window leaves after PROMPT_OVERHEAD_TOKENS. At the floor window this is
 *  1,000 tokens (~3 excerpts); an adaptive window raises it token for
 *  token. The pinned verified-quote chunks go in first, so the
 *  proven-relevant material is what survives the cut. */
export const evidenceCharBudget = (contextTokens: number): number =>
    (contextTokens - MAX_NEW_TOKENS - PROMPT_OVERHEAD_TOKENS) *
    CHARS_PER_TOKEN;
export const EVIDENCE_CHAR_BUDGET = evidenceCharBudget(CONTEXT_TOKENS);
