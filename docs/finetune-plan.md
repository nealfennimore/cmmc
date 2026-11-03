# Plan: fine-tune the app models on CMMC / NIST SP 800-171 material

Status: pipeline written (2026-11-03) in `models/finetune/pipeline/`. Training, evaluation, export, and publication have not run. The runbook is `models/finetune/pipeline/README.md`.

## Context

The dataset in `models/finetune/rev3/out_combined` holds 9,789 training rows of lookup questions and answers for Rev. 2 and Rev. 3. The app ships three models: Gemma 3 270M (ONNX q8), Llama 3.2 1B, and Llama 3.2 3B (ONNX q4f16 and GGUF Q4_K_M). The app uses them to draft control narratives from evidence and to review evidence. The app does not use them for lookup questions.

## Decisions

- Training runs on the RTX 4070 Ti eGPU (12 GiB), inside the dev shell of `modules/finetune`. That repo supplies the verified environment, the version pins, the training loop, and the GGUF converter. Its trigger data is not used.
- All three models get a LoRA fine-tune. Each merged model is exported to every format that the app loads for that model.
- The weights go to public Hugging Face repos under the user account: `<hub_name>-ONNX` and `<hub_name>-GGUF`. The download path in `model_store.rs` accepts only huggingface.co URLs and sends no token.
- A regression suite on the real draft prompt gates publication. A tuned model must not leak requirement language into drafts or add ungrounded details.

## Changes, in order

1. Run `run_all.sh` for each model on the 4070 Ti (README sections 1 to 3).
2. Apply the ship criteria (README section 4). If a model fails, try `--general`, fewer epochs, or `--no-system`.
3. Publish the passing models (`publish_hf.sh`).
4. Add the manifest entries and pin them with `update-model-manifest.mjs` (README section 6).
5. Decide whether the tuned models replace the defaults or appear as extra choices.
6. Load each new model in the app: native GGUF on Linux, ONNX in the browser (`MODELS_PLATFORM=all npm run models`).

## First result and change of plan (2026-11-03)

Gemma 270M trained on the lookup Q&A only failed the draft gate. It answered every draft prompt in the lookup template and invented requirement text. The plan now trains on draft-task data first: `gen_drafts.py` makes evidence and grounded narratives with a teacher model for each of the 601 app sub-statements, and `build_mix.py` adds lookup Q&A at half that size.

## App bug found during this work

`getAssessmentGuidance` (`client/src/api/entities/AssessmentGuide.ts`) looks up the Rev 2 guide by element ID only. Rev 2 and Rev 3 share IDs such as `03.01.01`, so `draft_job.ts` gives a Rev 3 draft the Rev 2 objective with the same number and letter. For example, a draft for Rev 3 `03.01.01.a` (account types) receives the Rev 2 objective "authorized users are identified". This affects 124 of the 281 Rev 3 sub-statement drafts. The doc comment says that the function returns `undefined` for all of Rev 3, but nothing checks the revision. The training data follows the intended behavior: no objectives for Rev 3.

## Risks

- The dataset teaches facts, but the app task is grounded writing. A fine-tune can raise `mcq` accuracy and still make the drafts worse. The `draft` suite measures only this risk.
- The ONNX export path did not run. The 3B fp16 conversion can fail on the 2 GB protobuf limit. The fallback is to ship the 3B as GGUF only.
