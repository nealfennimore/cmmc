# Plan: embedding retrieval with a local embedding model

Status: implemented on branch `embedding-reranker` (2026-11-03). Not yet active: the embedder entry in the manifest is not pinned until the ONNX export is published (see "Open items"). Until then, retrieval stays BM25 only.

## Context

The review and draft features found evidence with BM25 only (`TextIndex.searchAny`). BM25 matches words, not meaning. Evidence that describes a control in other words ranks low, or never becomes a candidate. For example, an objective about "multifactor authentication" does not match a chunk that says "Duo push on every VPN login".

The stored chunk summaries (`llm/summarize.ts`) reduce this problem a little, because `buildChunkIndex` indexes them as extra words. But summaries exist only after a draft run, they use the words of the model, and a change of LLM made every summary stale.

This plan adds a small local embedding model. A dense ranking orders all chunks of a requirement by meaning. When the embedding model is not available, retrieval is BM25 only, which is the old behavior. The first version fused the dense and BM25 rankings (RRF). The eval showed that fusion ranks below dense alone, so the app now uses the dense ranking only ("Eval results").

## Decisions

- **The embedding model must come from the USA** (Neal, 2026-11-03). The base model and the ONNX conversion are in scope. `BAAI/bge-small-en-v1.5` (Beijing) is rejected for this reason.
- **Model:** IBM `ibm-granite/granite-embedding-small-english-r2` at revision `2ab6fa8ea2d674564defd37171ae19079b864b33`. License Apache-2.0. 47M parameters, ModernBERT architecture, 384 dimensions, 8,192-token window, CLS pooling, no query or passage prefix.
  - IBM trained it from scratch, and the model card lists permissively licensed training data.
  - transformers.js 4.2.0 (the pinned version) supports ModernBERT.
- **Own ONNX export.** `models/embedder/export.sh` converts the IBM weights with optimum and quantizes them to int8 (q8). `publish_hf.sh` uploads the result to `nealfennimore/granite-embedding-small-english-r2-ONNX`. The supply chain is IBM, then our script, then our repo. The `onnx-community` conversion is for measurement only.
- **Rejected candidates:**
  - `Snowflake/snowflake-arctic-embed-s` (US, Apache-2.0, 34 MB): the base model is Microsoft `e5-small-unsupervised`, so the lineage is less direct.
  - `ibm-granite/granite-embedding-30m-english`: replaced by r2, and it has a 512-token window.
  - `nomic-embed-text-v1.5` (137 MB) and EmbeddingGemma (Gemma license): larger, for no measured gain.
- **Dense ranking, with BM25 as the fallback** (Neal, 2026-11-03, after the eval).
  - The first decision was hybrid retrieval (RRF of BM25 and dense, `k = 60`). The argument was that BM25 matches identifiers exactly. That helps only when the query contains an identifier, and review queries are objective prose.
  - The agreed rule was: if dense-only matches or beats hybrid on recall@8 and MRR, BM25 leaves the fusion. On the eval, dense beat every fused variant ("Eval results").
  - BM25 stays as the fallback when the embedder is not available. That path, its query, and its fingerprint are the same as before the embedder existed.
  - `ai/hybrid.ts` keeps `fuseRankings` and `fusedOrder` (with optional weights) for the eval, which still reports the fused variants. Real evidence can reopen the question.
- **Embed all documents** (Neal, 2026-11-03). A background job (`llm/embed_sync.ts`) embeds every readable document when its extracted text lands, for both chunkings: `chunkText` (reviews) and `chunkDoc` (drafts). The `chunk_vectors` IndexedDB store (DB version 14) keys each vector by embedder id and `sha256(chunk text)`. A review or a draft then embeds only its query.
- **Runtime:** a separate Web Worker (`llm/embed_worker.ts`) runs the `feature-extraction` pipeline. It always uses `device: "wasm"` with the plain (non-JSEP) ONNX Runtime build.
  - The embedder never uses WebGPU memory, so it cannot push the LLM out of memory. WebKitGTK gives the WebGPU device only 1 GiB.
  - It also works on native builds, where the LLM runs in Rust (llama.cpp) and no LLM worker exists.
  - The background job waits while the LLM generates or loads, because a WASM LLM shares the CPU.
- **Weights:** a new top-level `embedders` array in `models.manifest.json`. The `models` array feeds the LLM picker, so the embedder is not there. Every installer ships the embedder (about 50 MB). Delivery is the same as for LLM weights: same-origin `/models/` in dev, `read_model_file` over IPC on desktop.
- **AI toggle:** the embedder loads only when AI is on. When the user turns AI off, the app cancels the jobs first, then unloads the LLM and the embedder.
- **Fallback:** if the weights are missing, or the worker fails to load or run, retrieval is BM25 only. A session flag stops later retries. A failure never blocks a review or a draft.
- **Review fingerprint:** with the embedder, `reviewFingerprint` adds `retrieval:${RETRIEVAL_VERSION}` (now 2, after the switch from fusion to dense) and `embedder:${id}`. A BM25-only run adds neither part and keeps the old over-fetch, so this change alone makes no stored review stale. All stored reviews show as stale when the embedder first loads. This is acceptable.
- **Summaries no longer depend on the LLM** (Neal, 2026-11-03). Summaries had two jobs:
  1. Extra words for BM25 retrieval. Embeddings do this job better. The bridge stays, because it is harmless and helps the BM25-only fallback.
  2. Document overviews in the draft and review prompts. An embedder outputs vectors, not text, so it cannot do this job.
  - Now: `summaryFingerprint` drops `model:`. A summary from any model stays current, and a model switch costs nothing. Rows written before this change stay current: they match the old formula for the model that wrote them. "Re-summarize" on a file regenerates its summary.
  - Later: test drafts with and without the overviews. If drafts do not get worse, remove summarization. This is not in this change.

## Changes

1. **Manifest and build**
   - `models.manifest.json`: `embedders` entry `granite-embedding-small-english-r2`, unpinned (empty `revision` and hashes) until the export is published. The `note` text describes it.
   - `scripts/update-model-manifest.mjs`: `--embedder <id>`, a fixed file list, and `--verify` covers embedders.
   - `scripts/fetch-model-weights.mjs`, `scripts/sync-models.mjs`, `flake.nix`: fetch pinned embedders with no `bundlePlatforms` filter.
   - `llm/config.ts`: `EmbedderModel` and `EMBEDDER` (the first pinned entry, or `undefined`).
   - `read_model_file` (Rust) needs no change: it accepts any repo path under `models/`.
2. **Export tooling (`models/embedder/`)**: `export.sh`, `quantize.py` (MatMul and Gather to int8), `verify.py` (q8 against fp32: cosine ≥ 0.98, same top passage), `verify.mjs` (the app's transformers.js loads it), `publish_hf.sh`.
3. **Embedder runtime**: `llm/embed_protocol.ts`, `llm/embed_worker.ts`, `llm/embedder.ts` (availability probe, batches of 8, a memory LRU cache of 2,000 vectors, the `chunk_vectors` store, `unloadEmbedder`), `llm/embed_sync.ts`.
4. **Retrieval**: `ai/hybrid.ts` (pure: `RETRIEVAL_VERSION`, `dot`, `rankByVector`, and `fuseRankings`/`fusedOrder` for the eval, dev assertions). `ai/retrieval.ts`: `retrieveForObjective` is async and takes a `signal`. It returns the dense order when the embedder is available, else the BM25 order as before. The dense query is the objective text plus the requirement statement only. `Reranker` returns a `Promise` and stays the hook for a cross-encoder. `rankDraftChunks` gives the dense draft order.
5. **Drafts**: `selectChunks` takes `ranked` (chunk ids). `draft_job.ts` computes the dense order before `selectChunks`, and BM25 ranks when it is undefined. Quote chunks still come first.
6. **Fingerprints, toggle, settings**: review fingerprint as above. `model_settings.tsx` cancels the embed job and unloads the embedder on AI off, and shows a "Semantic search" line: "On", "Not available in this build", "Failed to load", or "Off". `chunk_vectors` is cleared on import and on database reset.
7. **Docs**: `docs/local-ai.md` ("Embedding retrieval"), `docs/rag-review-plan.md` (phase 3 note), this file.

## Verification

Done on 2026-11-03, in the sandbox:

- `npm run build` passes. The embed worker builds as its own chunk.
- `tsc --noEmit`: no new errors against a clean HEAD baseline, except two in the DB version 14 migration. They have the same `event.target.result` pattern as every older migration.
- ESLint: no findings in the changed lines.

Not done, because the sandbox network blocks PyPI and the Hugging Face CDN:

- The ONNX export (`export.sh`, `verify.py`, `verify.mjs`).
- Interactive checks, on Linux desktop and in `npm run dev:ai`:
  - AI off: no embed worker starts.
  - No embedder weights: reviews and drafts run with BM25 only, and settings show "Not available in this build".
  - Desktop build: weights load over IPC, the background job fills `chunk_vectors`, and a review runs end to end.
  - Stored reviews show as stale after the first load of the embedder.
  - Turn AI off during a review: the review stops, then both workers end.
  - A model switch keeps stored summaries ("Re-summarize" still regenerates).
- Measure the embedding time on the slowest supported machine (Intel macOS webview build).

## Eval results

Neal ran `scripts/eval-retrieval.mjs` on 2026-11-03 with the `onnx-community` export of the same IBM weights (measurement only). The fixture is `models/finetune/pipeline/fixtures/retrieval_cases.json`: 5 requirements, 64 chunks, 19 objectives. The objective fields are a snapshot of `objectivesForRequirement`.

Gate, in each pool: recall@8 must be equal to or higher than BM25 for every requirement, and higher overall.

| Method | Requirement pool r@8 | Requirement pool MRR | All pool r@8 | All pool MRR | Gate |
|---|---|---|---|---|---|
| bm25 | 0.64 | 0.29 | 0.19 | 0.13 | — |
| **dense** (shipped) | 0.74 | 0.41 | 0.57 | 0.29 | PASS in both pools |
| hybrid (RRF) | 0.69 | 0.31 | 0.36 | 0.19 | FAIL (all pool) |
| hybrid-lean (short BM25 query) | 0.75 | 0.29 | 0.44 | 0.20 | PASS |
| hybrid-w2 (dense weight 2) | 0.73 | 0.34 | 0.39 | 0.23 | FAIL (all pool) |
| hybrid-lean-w2 | 0.77 | 0.39 | 0.49 | 0.25 | PASS |

- The all pool (every chunk is a candidate) decides it. Dense leads every fused variant on recall@8 and on MRR.
- In the requirement pool, the best fused variant ties dense: a little higher on recall@8, a little lower on MRR. One objective moves an average by about 0.05.
- BM25 is close to chance in the all pool (0.19 against 8/64 = 0.125). A shorter BM25 query does not help BM25 alone (0.17).
- Embedding time: 3.8 ms per chunk on Node CPU, in batches of 8.
- Caveat: one author wrote the fixture, with relevant chunks that use other words than the objectives. That favors dense by design. Run the eval again on real evidence.

## Open items

1. On a machine with network access: `cd models/embedder && ./export.sh && node verify.mjs`.
2. Run `node scripts/eval-retrieval.mjs --local-dir models/embedder/runs/granite-embedding-small-english-r2/onnx`, our export instead of the `onnx-community` one. Do not publish if the gate fails.
3. `./publish_hf.sh nealfennimore`. Then `node scripts/update-model-manifest.mjs --embedder granite-embedding-small-english-r2` and `npm run models` in `client/`.
4. Run `node scripts/eval-retrieval.mjs` again. It now uses our export from `client/public/models/`.
5. Do the interactive checks above.

## Risks

- **CPU time.** The embedder runs on single-thread WASM in the app. The background job hides the cost of the documents, but the first pass over a large evidence set takes minutes. Measure it on the slowest machine.
- **ModernBERT on WASM.** The architecture is newer than BERT. `verify.mjs` checks the load in Node, but not in WebKitGTK. Check it in the interactive pass.
- **Two ONNX Runtime instances.** Where the LLM also runs on WASM, both workers hold an ONNX Runtime heap. The embedder adds about 50 MB of weights and a small activation heap.
- **Quality regression.** Dense retrieval can rank generic policy text high for every objective. The fixture contains such traps (policy text that restates the requirement, a badge-plus-PIN procedure that resembles MFA). Without fusion, no second ranking limits this. The eval gate must pass before the embedder is pinned.
- **Identifier queries.** Dense ranking is weak when the query contains an exact identifier. Review and draft queries do not, and drafts pin verified-quote chunks directly. A future search feature with typed queries needs BM25.
- **Fixture bias.** One author wrote the fixture and its labels. Add real, anonymized evidence when it is available.
