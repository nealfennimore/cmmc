# Local AI: evidence-based control summaries

## Overview

The app can draft a control narrative from the evidence that is attached to a requirement. A small language model runs fully on the user's device. The model is US-developed (Meta Llama). Evidence and notes never leave the machine.

One model exists in two formats: Llama 3.2 1B Instruct CMMC, a LoRA fine-tune of Llama 3.2 1B for the draft task (`models/finetune/pipeline`). The ONNX entry (`llama-3.2-1b-instruct-cmmc`) runs in the webview on WebGPU. The GGUF entry (`llama-3.2-1b-instruct-cmmc-gguf`) runs natively (llama.cpp) on Linux, Apple Silicon macOS, and Windows. The weights come from `nealfennimore/Llama-3.2-1B-Instruct-CMMC-ONNX` and `-GGUF` on Hugging Face. No installer bundles model weights. The user adds the model in the AI settings: a one-click verified download, or an offline import of the exact pinned file (see "Adding a model" below). The reason is size: GitHub caps release assets below 2 GiB, and the NSIS installer has the same limit. Intel macOS stays on the in-webview runtime and uses the ONNX entry. See "Native inference (desktop)" below.

A user can explicitly download or import a pinned model in the AI settings. The app verifies every byte against the manifest (size and sha256) before use. Nothing downloads without a user action, and evidence and notes never leave the machine. Until the user adds a model, the feature shows as unavailable. The free web tier does not include the feature at all.

## Architecture

- Runtime: `@huggingface/transformers` (ONNX Runtime Web) in a Web Worker (`client/src/app/llm/worker.ts`). The runtime uses WebGPU when available, with a WASM fallback. The worker reads weights only from the app's own `/models/` tree (`env.allowRemoteModels = false`).
- The ONNX WASM binaries ship in the app bundle at `/ort/`. The script `client/scripts/copy-ort-assets.mjs` copies them from node_modules on each build. The runtime never fetches them from a CDN.
- Weights: pinned in `client/src/app/llm/models.manifest.json` (URL, revision, size, sha256 for each file). This manifest is the single source of truth for:
  - `flake.nix` — fetches each file as a fixed-output derivation (`nix build .#model-weights`) and copies the tree into `public/models/` before the frontend build of the desktop package.
  - `scripts/fetch-model-weights.mjs` — stages verified weights into `client/public/models/` for builds outside the Nix package and for local dev. Run it with `npm run models` in `client/`. Where the `nix` CLI exists, the script builds `.#model-weights` and copies from the Nix store, so each file downloads once and stays cached in the store. Without Nix (Windows/macOS CI, non-Nix dev machines), the script downloads each file directly and verifies it against the manifest.
  - `client/src/app/llm/config.ts` — sizes and license notices in the UI.
- Desktop delivery: the weights are Tauri **bundle resources** (`tauri.conf.json` maps `../public/models` to `resource_dir()/models`), NOT embedded frontend assets. Tauri's `generate_context!` compiles everything in `out/` into the binary, and gigabytes of weights there make rustc run out of memory (OOM SIGKILL) — so `scripts/strip-model-assets.mjs` (npm postbuild) removes `out/models` after every static export. At runtime the engine reads each file over IPC (`read_model_file` in `src-tauri/src/lib.rs`, raw-byte responses) and transfers the buffers into the worker, which serves them to transformers.js through a custom cache. In `next dev` the files are simply fetched from the dev server origin instead.
- Consumers reach the model through the `LocalModel` seam in `client/src/app/ai/model.ts`. The engine registers itself there when the weights load. The RAG review layer (`docs/rag-review-plan.md`) builds on the same seam.
- Prompt assembly (`client/src/app/llm/prompt.ts`): evidence text comes from the `evidence_text` IndexedDB store. Chunks are ranked with the hand-rolled BM25 index (`TextIndex.searchAny`). The budget is 4,096 context tokens with 512 reserved for output.
- UI: a "Draft from evidence" button on the requirement page opens the draft panel (`client/src/app/components/ai/draft_panel.tsx`). The user reviews the streamed draft, then inserts it into a description field. Insertion goes through the normal autosave path. Nothing persists until the user inserts. The "AI Assistant" menu entry shows the model choice, the engine status, and the master switch.

## Manifest maintenance

For routine maintenance, run one command in `client/` (network required):

```
npm run models:sync              # re-pin every model at its current revision, then fetch weights
npm run models:sync -- --latest  # bump every model to upstream HEAD instead
```

`scripts/sync-models.mjs` re-pins each manifest entry through `update-model-manifest.mjs`, then fetches and verifies the weights into `client/public/models/` (with pruning of files the manifest no longer lists). `--id <id>` limits it to one model. `--no-fetch` updates the manifest only. Review the manifest diff like a lockfile change before you commit.

The lower-level script is `node scripts/update-model-manifest.mjs --id <id>`. It:

1. Resolves the repo's current revision through the Hugging Face API, unless `--revision` pins one.
2. Enumerates the repo's `onnx/` tree and includes the graph file and every external-data shard (`model_<dtype>.onnx_data*`). The graph file alone is often only a few hundred KB — the weights live in the shards. A manifest without the shards builds an app whose model cannot load.
3. Downloads and hashes each file, then rewrites the entry. Where the `nix` CLI exists, the download runs through `nix store prefetch-file`. The bytes then sit in the Nix store under the same name and hash that `flake.nix` uses. The later `nix build .#model-weights` and `npm run models` reuse them without a second download.

Review the diff like a lockfile change. `--verify` re-checks every recorded hash against upstream.

A correct entry for these repos contains the small `onnx/model_*.onnx` graph plus its large `.onnx_data` shard(s). An entry whose ONNX files total well under the model's parameter size is missing shards — run `npm run models:sync` to repair it. The runtime reads the shard count from the manifest (`use_external_data_format`), so a wrong manifest cannot load.

## Where weights come from, per build

| Build | Weight source | Runtime access |
|---|---|---|
| `nix build` (Linux desktop) | `model-weights` derivation, copied into `public/models/` in `preBuild` | Tauri resources, IPC |
| Linux release CI (`desktop-nix`) | `scripts/fetch-model-weights.mjs`, which copies from the `model-weights` derivation (the Nix store cache carries the weights between runs) | Tauri resources, IPC |
| Windows/macOS CI | "Fetch model weights" step in `deploy.yml` (`scripts/fetch-model-weights.mjs`, direct download — no Nix on those runners) | Tauri resources, IPC |
| Local desktop dev | `npm run models` in `client/`, once, before `npm run dev` / `cargo tauri dev` (copies from the Nix store on Nix machines) | Dev-server origin fetch |
| Web (GitHub Pages, free tier) | None — the feature is absent (`FREE_TIER`), and GitHub Pages cannot host >100 MB files anyway | — |

`client/public/models/` and `client/public/ort/` are gitignored build artifacts.

Build note: `onnxruntime-node` (a transformers.js dependency, Linux x64 only) tries to download CUDA binaries from GitHub in its npm install script. The app never uses it — inference runs on `onnxruntime-web`. `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` disables the download. The flake sets it for the Nix package and for the dev shells. Set it manually for any `npm ci` outside those shells on Linux x64 without network.

## Device policy

- The ONNX model requires WebGPU. Chromium, WebView2, and recent WKWebView provide it. No model runs on WASM: the Gemma 3 270M lite model was removed.
- The context window is adaptive (`contextTokensFor` in `client/src/app/llm/config.ts`). It scales with the adapter's reported buffer limit and the model's vocabulary: floor 2,560 tokens, cap 6,144. The prefill logits tensor (sequence x vocab, fp32) is the binding allocation.
- The buffer limit is per browser engine, not per GPU. The same AMD 780M reports 1 GiB in webkitgtk and 4 GiB−4 in Chromium with Vulkan enabled. An adapter whose limit cannot hold a working window (below `MIN_CONTEXT_TOKENS`) marks WebGPU models unusable there.
- When the selected model cannot run, `resolveUsableModel` falls back: selection, then the native 1B (desktop), then the ONNX 1B default. The settings modal names the substitution. Only a device with no usable model hides the AI features.
- Linux webkitgtk reports no WebGPU or a 1 GiB limit. In the browser those machines have no usable model. The Linux desktop app runs the native path instead.

## Native inference (desktop)

The Linux, Apple Silicon macOS, and Windows desktop apps run Llama through llama.cpp inside the Rust process (`src-tauri/src/native.rs`), not the webview — the webview only renders UI. Backends: Vulkan on Linux and Windows (with a CPU fallback that still beats WASM; on Windows `vulkan-1.dll` is delay-loaded so driverless machines launch), Metal on Apple Silicon. Intel Macs stay on the webview path — ggml-metal does not support them. Design and rationale: `docs/native-inference-plan.md`.

- Models: GGUF entries in the manifest (`format: "gguf"`, `minDevice: "native"`, `bundlePlatforms: []`). No installer carries them. The user downloads or imports one. One file per model. The tokenizer and the chat template ship inside it.
- Transport: `client/src/app/llm/native_worker.ts` speaks the worker protocol over Tauri invoke commands (`native_probe/load/generate/poll/abort/unload`), polling for streamed tokens. The engine picks it per resolved device; everything above the transport is shared with the webview path.
- Window: `MAX_CONTEXT_TOKENS` (6,144) as `n_ctx`. No adapter-limit math applies.
- Build: Rust features `native-llm-vulkan` (Linux via the Nix package's `tauriBuildFlags`; Windows CI, which installs a pinned LunarG Vulkan SDK) and `native-llm-metal` (aarch64 macOS CI leg). Default builds compile stubs, so `cargo check` needs no cmake/Vulkan. The .deb/.rpm declare the Vulkan loader dependency; Windows delay-loads `vulkan-1.dll` instead (src-tauri build.rs).
- Adding a model: the AI Assistant settings offer "Download" and "Import model file…" for any pinned model that the installer excluded (every model). Download streams the manifest's pinned https URL in the Rust process (`model_store.rs`), hashes in flight, and renames into `app_data_dir()/models/` only on a verified sha256 — a cancel or mismatch removes the partial file, and exactly one host (huggingface.co, plus its CDN redirect) is contacted, only on the user's confirmation. Import verifies a user-supplied file the same way, fully offline — the supported path for air-gapped environments (GGUF models only; the picker is single-file). Bundle resources win when both copies exist; a "Remove" button reclaims the disk. Design: `docs/model-download-plan.md`.
- Dev note: `npm run models` filters weights by platform (`bundlePlatforms`). Every entry has an empty list, so the script only prunes. To stage weights for browser testing of the ONNX path, run `MODELS_PLATFORM=all npm run models`.
- Linux memory: webkitgtk's memory-pressure monitor kills the web process at conservative thresholds, which model loading trips. The app sets `WEBKIT_DISABLE_MEMORY_PRESSURE_MONITOR=1` at startup (src-tauri `run()`), and the desktop IPC path streams one weight file at a time so peak memory stays near a single copy per file plus the ONNX Runtime heap.
- IPC transport: `read_model_file` returns base64 strings in 32 MB binary slices (`offset`/`len`), the same pattern as the app's other large payloads. A raw-bytes `tauri::ipc::Response` of a 300 MB weight file crashed the webkitgtk web process outright — do not switch back without testing that exact case on Linux.

## Verification checklist

1. Privacy audit (critical). Open the app, attach evidence, and run a full summarize with DevTools network open. Zero network requests must occur at any point — the weights load from the app's own origin or local resources. Repeat once inside Tauri behind a proxy such as mitmproxy. Model import must also work with the network fully disabled. Trigger a model download and confirm that exactly one host is contacted (huggingface.co plus its CDN redirect), and only after the confirmation dialog. Confirm that a cancel removes the `.partial` file and that a tampered byte fails the checksum.
2. Nix. Run `nix build .#model-weights`. It must fetch and verify the pinned files. Run `nix build`. The desktop app must summarize with no network access. Corrupt one hash in the manifest and confirm that the build fails with a hash mismatch.
3. Flow. Generate a draft, insert it, reload, and confirm that the note persisted through autosave. Stop mid-generation and confirm that the partial draft is insertable.
4. Matrix. Test Chrome with WebGPU, Chrome with `--disable-features=WebGPU` (feature hidden, no usable model), the free-tier build (feature absent), and Tauri on each OS.
5. Regression. Confirm that evidence attach, text extraction, search, and exports are unaffected. The feature is additive and lazy.

## Debugging a web-process crash (Linux)

The webview console is invisible in release builds. The AI path therefore logs breadcrumbs to stderr through the `ai_debug_log` command: engine stages, every weight-file transfer with byte counts, worker stages (WASM SIMD support, tokenizer, session creation), and worker errors. A web-process crash cuts the trail — the last line names the failing stage.

1. Run `nix run .#cmmc 2>&1 | tee /tmp/cmmc-ai.log` and trigger the model load.
2. Read the tail of the log:
   - trail ends after `engine: read ... bytes` or `cache: requesting ...` — the crash is in the IPC transfer or the message channel.
   - trail ends after `load: tokenizer ready; model starting ...` — the crash is in ONNX Runtime WASM startup or session creation (the JavaScriptCore WASM JIT is the prime suspect).
   - `worker onerror: ...` appears — the worker script died with a real error; the message tells you why.
3. Get the crash signal and stack: `coredumpctl list | tail`, then `coredumpctl info <PID>` for the newest `WebKitWebProcess` entry. SIGSEGV/SIGILL inside JSC WASM frames confirms a JIT fault.
4. Bisect JavaScriptCore behavior with env vars on the app process (the web process inherits them). Test one at a time:
   - `JSC_useOMGJIT=0` — disable the top WASM JIT tier.
   - `JSC_useBBQJIT=0` — also disable the mid tier (slow, interpreter-only).
   - `JSC_useWebAssemblySIMD=0` — a clean "validation failed" error instead of a crash confirms the SIMD path.
   - `WEBKIT_FORCE_SANDBOX=0` — rule out the web-process sandbox.

If a JIT tier is the culprit, the fix is to pin that option in the app wrapper for webkitgtk until the upstream JSC fix ships. No current model runs on WASM, so this section applies only if a WASM model returns.

Case history (2026-08-27): session creation aborted with a messageless C++ exception on BOTH webkitgtk and Chrome after all files transferred correctly. The worker's abort decoder recovered the real text: `Unrecognized attribute: bits for operator GatherBlockQuantized` — the upstream q4 export required a newer ONNX Runtime than the one transformers.js bundled. Lesson: a numeric ORT abort usually has a real message in the WASM heap (the worker decodes it now), and a model revision can require a newer runtime than the pinned `@huggingface/transformers` — check both sides of that version pair when bumping either. Along the way, CPU-only sessions were switched to the plain (non-JSEP) `ort-wasm-simd-threaded` pair (`copy-ort-assets.mjs` ships both variants) — kept, since CPU sessions need none of the JSEP machinery.

## Known limits

- The summarizer reads extracted text only. Image-only evidence appears in the panel as "no readable text".
- A stopped generation keeps the partial draft. The user can still insert or regenerate.
- One generation runs at a time. The engine rejects a second concurrent request.
- Desktop installers carry no model weights, so they stay well under GitHub's 2 GiB release-asset cap (the deploy workflow fails fast on any oversized Linux bundle). A device without WebGPU and without the native path has no usable model.
