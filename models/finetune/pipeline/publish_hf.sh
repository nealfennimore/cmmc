#!/usr/bin/env bash
# Upload one model's exports to Hugging Face, one repo per format, the same
# split as the upstream repos that the app manifest pins today:
#   <user>/<hub_name>-ONNX   config, tokenizer, onnx/model_<suffix>.onnx(+_data)
#   <user>/<hub_name>-GGUF   <hub_name>-Q4_K_M.gguf                (Llamas only)
#
# Usage: ./publish_hf.sh <hf user> <model id> [--private]
#
# The script refuses an export that is older than runs/<model>/merged, and
# refuses a public upload unless compare.py passes (README.md, "Ship
# criteria"). The repos must be public for the app download: model_store.rs
# sends no token.
# Log in once with: uv run hf auth login
set -euo pipefail
cd "$(dirname "$0")"
user="${1:?usage: $0 <hf user> <model id> [--private]}"
model="${2:?usage: $0 <hf user> <model id> [--private]}"
private=""; [ "${3:-}" = "--private" ] && private="--private"
hub="$(uv run python -c "from presets import PRESETS; print(PRESETS['$model']['hub_name'])")"
run="runs/$model"
[ -f "$run/eval/tuned.json" ] || { echo "missing $run/eval/tuned.json: run evaluate.py first"; exit 1; }

# An export older than the merged weights comes from an earlier training run.
for d in "$run/onnx" "$run/gguf"; do
    if [ -d "$d" ] && [ "$d" -ot "$run/merged" ]; then
        echo "$d is older than $run/merged: it holds an earlier model. Export again first."
        exit 1
    fi
done
# Public repos feed the app's download; only a model that passes the ship criteria goes there.
if ! uv run python compare.py --model "$model"; then
    if [ -z "$private" ]; then
        echo "compare.py says FAIL: refusing a public upload. Add --private to upload for testing only."
        exit 1
    fi
    echo "compare.py says FAIL: uploading as a private repo, for testing only."
fi

base="$(jq -r .preset.base "$run/run.json")"          # repo the weights came from (may be a mirror)
upstream="$(jq -r '.preset.upstream // .preset.base' "$run/run.json")"  # original publisher, for license and card
case "$upstream" in
    meta-llama/*) license="llama3.2"; notice="Built with Llama. Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright (c) Meta Platforms, Inc. All Rights Reserved. A copy of the license ships in this repo as LICENSE." ;;
    google/*) license="gemma"; notice="Gemma is provided under and subject to the Gemma Terms of Use found at https://ai.google.dev/gemma/terms" ;;
esac

card() {
    cat <<CARD
---
license: $license
base_model: $upstream
tags: [cmmc, nist-800-171, lora]
---
# $hub

A LoRA fine-tune of [$upstream](https://huggingface.co/$upstream), merged into the base
weights, for the local AI features of [cmmc-app](https://github.com/nealfennimore/cmmc).
The training data comes from NIST SP 800-171 Rev. 2 and Rev. 3, SP 800-171A, and
the CMMC Assessment Guide Level 2. A script assembled every answer from the source documents.

$notice

## Evaluation (base → tuned)

\`\`\`
$(jq -n --slurpfile b "$run/eval/base.json" --slurpfile t "$run/eval/tuned.json" '{mcq: [$b[0].mcq.overall, $t[0].mcq.overall], recall_f1: [$b[0].recall.f1, $t[0].recall.f1], draft_leak_rate: [$b[0].draft.leak_rate, $t[0].draft.leak_rate], draft_ungrounded_per_draft: [$b[0].draft.ungrounded_per_draft, $t[0].draft.ungrounded_per_draft]}')
\`\`\`
CARD
}

up() { # up <repo> <dir>
    uv run hf repos create "$user/$1" --type model $private --exist-ok >/dev/null
    card > "$2/README.md"
    case "$upstream" in
        # Llama 3.2 license 1.b.i: redistribute with a copy of the license and the use policy.
        # From the Meta repo: mirrors such as unsloth/ do not carry these files.
        meta-llama/*) uv run hf download "$upstream" LICENSE.txt USE_POLICY.md --local-dir "$2" >/dev/null
                      mv "$2/LICENSE.txt" "$2/LICENSE" ;;
        # Gemma Terms 3.1: pass on the use restrictions and the notice.
        google/*) printf '%s\n' "$notice" > "$2/NOTICE" ;;
    esac
    rm -rf "$2/.cache"
    uv run hf upload "$user/$1" "$2" . --commit-message "CMMC LoRA fine-tune of $(jq -r .preset.base "$run/run.json")"
    echo "https://huggingface.co/$user/$1"
}
[ -d "$run/onnx" ] && up "$hub-ONNX" "$run/onnx"
[ -d "$run/gguf" ] && up "$hub-GGUF" "$run/gguf"
