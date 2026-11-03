# CMMC fine-tune pipeline

This pipeline LoRA-tunes the three models that the app ships and exports them into the formats that the app loads. The training loop, the environment, and the GGUF converter come from `modules/finetune`, which ran on the same RTX 4070 Ti. Only that tooling is reused. The trigger data and adapters of that repo are not part of this pipeline.

| Model id | Base | App formats | Hub repos |
|---|---|---|---|
| `gemma-3-270m-it` | `google/gemma-3-270m-it` | ONNX q8 | `<user>/gemma-3-270m-it-CMMC-ONNX` |
| `llama-3.2-1b-instruct` | `meta-llama/Llama-3.2-1B-Instruct` | ONNX q4f16, GGUF Q4_K_M | `<user>/Llama-3.2-1B-Instruct-CMMC-ONNX`, `-GGUF` |
| `llama-3.2-3b-instruct` | `meta-llama/Llama-3.2-3B-Instruct` | ONNX q4f16, GGUF Q4_K_M | `<user>/Llama-3.2-3B-Instruct-CMMC-ONNX`, `-GGUF` |

The Llama 3.2 license requires that a derivative name begins with "Llama". The hub names in `presets.py` obey this rule.

## Lesson from the first run

The first run trained Gemma 270M on the lookup Q&A only (`../rev3/out_combined`). MCQ accuracy went from 0.16 to 0.26, but the model stopped drafting from evidence. It answered every draft prompt in the lookup template ("**AC.L2-3.1.1 – Title** (NIST SP 800-171 …)") and invented requirement text. The leak rate went from 0.5 to 1.0, and invented details went from 1 to 8 per draft.

The app uses these models to draft narratives from evidence, not to answer lookup questions. The training data must therefore teach the draft task. Lookup Q&A can be a smaller share of the mix.

## Files

| File | Purpose |
|---|---|
| `presets.py` | Base repo, batch size, learning rate, LoRA rank, and export formats for each model |
| `app_prompt.py` | The app draft prompt in Python, built from `client/public/data` like `draft_job.ts` does |
| `checks.py` | Rule checks for a draft: leaks, invented details, pronouns, formatting, length |
| `gen_drafts.py` | Builds draft-task data with a teacher model (standard library only) |
| `build_mix.py` | Mixes the draft data with a share of the lookup Q&A |
| `train.py` | LoRA SFT. The loss applies to the final assistant turn only. |
| `merge.py` | Merges the adapter into the base weights: `runs/<model>/merged` |
| `evaluate.py` | Three suites: `mcq`, `recall` (held-out phrasings), `draft` (the app task) |
| `compare.py` | Prints base and tuned scores and the ship verdict. Exits with 1 on FAIL. |
| `export_onnx.sh`, `quantize_onnx.py`, `inline_chat_template.py` | ONNX export in the onnx-community layout that the app pins |
| `verify_onnx.mjs` | Loads the ONNX export with the transformers.js version in `client/node_modules` |
| `export_gguf.sh` | GGUF Q4_K_M for the native desktop path |
| `publish_hf.sh` | Uploads the exports, the model card, and the license files |
| `run_all.sh` | Runs all steps for one model |
| `fixtures/draft_cases.json` | Fixed evidence for four Rev 2 requirements. These requirements never go into training. |

## 1. Prepare the machine

1. Connect the eGPU and load the UVM module:

   ```
   sudo modprobe nvidia_uvm
   ```

2. Stop Ollama. Ollama and training compete for VRAM.

   ```
   systemctl stop ollama
   ```

3. Enter the dev shell of `modules/finetune` from the repository root. The shell supplies Python, `uv`, the CUDA library path, and `LLAMA_CPP_SRC`.

   ```
   nix develop ./modules/finetune
   cd models/finetune/pipeline
   uv sync --group export
   ```

4. On huggingface.co, accept the licenses of `meta-llama/Llama-3.2-1B-Instruct`, `meta-llama/Llama-3.2-3B-Instruct`, and `google/gemma-3-270m-it`. All three repos are gated.

5. Log in to Hugging Face:

   ```
   uv run hf auth login
   ```

6. Install the client packages if `client/node_modules` does not exist. `verify_onnx.mjs` uses them.

   ```
   (cd ../../../client && ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci)
   ```

## 2. Build the draft-task data

`gen_drafts.py` covers every sub-statement that the app can draft: 320 for Rev 2 and 281 for Rev 3. For each sub-statement and variant, a teacher model does two things:

1. It writes two to four evidence excerpts for a fictional organization. The excerpts fully cover the statement, partly cover it, or include unrelated excerpts as retrieval noise.
2. It writes the narrative for the exact app prompt.

`checks.py` rejects each narrative that leaks requirement language, invents a name or a number, uses "they", or uses lists or headings. The teacher gets up to two rewrites with the list of problems.

The teacher is Claude Opus 5.5 through the GoModel gateway. The Claude backend uses the Anthropic SDK, which reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from the environment. Set both variables before the run, for example from the `extraEnv` block in the root `flake.nix`.

1. Run a trial of 10 rows. The script prints the token use and the cost at list price.

   ```
   uv sync --group teacher
   uv run python gen_drafts.py --backend claude --limit 10 --variants 1
   ```

2. Read the 10 rows. If the gateway rejects the request with a 400 that names the fallback beta, add `--no-fallback`.

3. Run the full set. The script skips the rows that the trial already made.

   ```
   uv run python gen_drafts.py --backend claude --variants 2 --workers 4
   ```

The full run costs about $50 at list price with `--effort medium` (the default). Use the trial numbers to check this estimate before the full run.

The script also works with any OpenAI-compatible endpoint, for example a local open-weight model:

```
python3 gen_drafts.py --base-url https://fwdesktop.54rockybrook.house/v1 \
    --model qwen3.8-27b --variants 2 --workers 4 --no-think --limit 20     # smoke test
python3 gen_drafts.py --base-url https://fwdesktop.54rockybrook.house/v1 \
    --model qwen3.8-27b --variants 2 --workers 4 --no-think               # full run
```

If the endpoint needs a key, set `TEACHER_API_KEY`. The script appends each result to `data/draft/raw.jsonl`. If the run stops, run the same command again, and it continues. At the end, the script writes `train`, `valid`, and `test` files, split by requirement. About 10% of the requirements go to `test`.

Read 20 rows before you train:

```
shuf -n 20 data/draft/train.jsonl | jq -r '.meta.focusId + " (" + .meta.mode + ")\n" + .messages[-1].content + "\n"'
```

Then build the training mix:

```
python3 build_mix.py --lookup-ratio 0.5
```

## 3. Smoke test

```
uv run train.py --model gemma-3-270m-it --data data/mix --limit 200 --epochs 0.2 --runs runs-smoke
```

If the run reports an out-of-memory error, halve `batch` and double `grad_accum` for that model in `presets.py`.

## 4. Full run

Run one model at a time, from the smallest to the largest:

```
./run_all.sh gemma-3-270m-it --data data/mix
./run_all.sh llama-3.2-1b-instruct --data data/mix
./run_all.sh llama-3.2-3b-instruct --data data/mix
```

Each command does these steps:

1. Evaluates the base model, if no current base report exists.
2. Trains, merges, and evaluates the tuned model.
3. Prints the comparison. On FAIL, the script stops here.
4. Exports ONNX, verifies the ONNX export, and exports GGUF.

The output goes to `runs/<model>/`. Git does not track `runs/`.

## 5. Ship criteria

The `draft` suite sends the exact app prompt for every sub-statement of the four fixture requirements and for up to 150 held-out rows of `data/draft/test.jsonl`. `compare.py` prints `PASS` only if all of these conditions are true:

- The draft pass rate goes up. A draft passes when `checks.passes` finds no problem.
- The draft leak rate does not go up.
- The invented details per draft do not go up.

MCQ and recall scores are reported, but they do not decide. After `PASS`, read the drafts in `runs/<model>/eval/tuned.json` and compare them with `base.json`.

`app_prompt.py` mirrors `buildMessages` in `client/src/app/llm/prompt.ts` and the input steps in `draft_job.ts`. If either file changes, update `app_prompt.py`, rebuild the data, and evaluate again.

## 6. Publish

```
./publish_hf.sh <hf user> gemma-3-270m-it
./publish_hf.sh <hf user> llama-3.2-1b-instruct
./publish_hf.sh <hf user> llama-3.2-3b-instruct
```

The repos must be public. The app download in `model_store.rs` sends no token, and it accepts only `https://huggingface.co/` URLs.

## 7. Pin the new weights in the app

For each published repo:

1. Copy the existing entry in `client/src/app/llm/models.manifest.json` to a new entry. Set a new `id` (for example, `llama-3.2-1b-instruct-cmmc-gguf`), a new `label`, and the new `repo`. Keep `format`, `dtype`, `minDevice`, `bundlePlatforms`, and the license fields.
2. Pin the entry. Run this command from the repository root:

   ```
   node scripts/update-model-manifest.mjs --id <new id>
   ```

3. Review the manifest diff like a lockfile change.

## Status

- Verified on the 4070 Ti: Gemma 270M training at batch 1, merge, ONNX q8 export, and `verify_onnx.mjs`.
- Verified without a GPU: `gen_drafts.py` against a mock endpoint (generation, rewrites, resume, splits), `build_mix.py`, and `checks.py`.
- Not run: draft-data generation with a real teacher, any Llama training, the q4f16 and GGUF exports.
- The ONNX environment (`onnx/pyproject.toml`) has no version pins. Commit `onnx/uv.lock` now that the Gemma export passed.
- The 3B q4f16 export holds more than 2 GB of tensors in memory during the fp16 conversion. If the conversion fails, ship the 3B as GGUF only. Only the Intel macOS webview build uses the ONNX Llamas.
