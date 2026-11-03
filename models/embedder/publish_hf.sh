#!/usr/bin/env bash
# Upload the embedder export to Hugging Face as <user>/<name>-ONNX. The
# repo must be public: the app's build fetches it without a token
# (flake.nix, scripts/fetch-model-weights.mjs).
#
# Usage: ./publish_hf.sh <hf user> [--private]
# Then:  node ../../scripts/update-model-manifest.mjs --embedder granite-embedding-small-english-r2
#
# The script refuses an export that verify.mjs rejects.
# Log in once with: uv run --project ../finetune/pipeline hf auth login
set -euo pipefail
cd "$(dirname "$0")"
# uv warns when an unrelated virtualenv is active; this script picks its
# environments with --project.
unset VIRTUAL_ENV
user="${1:?usage: $0 <hf user> [--private]}"
private=""; [ "${2:-}" = "--private" ] && private="--private"

name="granite-embedding-small-english-r2"
run="runs/$name"
dst="$run/onnx"
# The hf CLI comes from the training environment (huggingface-hub 2.2.0,
# the same as finetune/pipeline/publish_hf.sh). The ONNX environment pins
# 0.36.2, whose CLI has "repo" instead of "repos".
hub_env="../finetune/pipeline"
[ -f "$run/source.json" ] || { echo "missing $run/source.json: run ./export.sh first"; exit 1; }
upstream="$(jq -r .upstream "$run/source.json")"
revision="$(jq -r .revision "$run/source.json")"
node verify.mjs

# Apache-2.0 section 4: give recipients a copy of the license, and state
# that we changed the files (ONNX conversion and int8 quantization).
curl -sfL https://www.apache.org/licenses/LICENSE-2.0.txt -o "$dst/LICENSE"
cat > "$dst/README.md" <<CARD
---
license: apache-2.0
base_model: $upstream
library_name: transformers.js
pipeline_tag: feature-extraction
tags: [onnx, embeddings, retrieval]
---
# $name-ONNX

An ONNX export of [$upstream](https://huggingface.co/$upstream) at revision
\`$revision\`, for the hybrid evidence retrieval in
[cmmc-app](https://github.com/nealfennimore/cmmc).

Changes from the original: we converted the weights to ONNX with optimum
(task feature-extraction) and quantized the MatMul weights to int8 with
ONNX Runtime dynamic quantization (\`onnx/model_quantized.onnx\`, the
transformers.js "q8" dtype). The tokenizer and config files are unchanged.
The scripts are in \`models/embedder\` of the cmmc-app repository.

Use CLS pooling and normalize the vectors. Queries and passages get no prefix.

The original model is by IBM and is licensed under the Apache License 2.0.
A copy of the license is in LICENSE.
CARD

uv run --project "$hub_env" hf repos create "$user/$name-ONNX" --type model $private --exist-ok >/dev/null
uv run --project "$hub_env" hf upload "$user/$name-ONNX" "$dst" . --commit-message "ONNX q8 export of $upstream@$revision"
echo "https://huggingface.co/$user/$name-ONNX"
