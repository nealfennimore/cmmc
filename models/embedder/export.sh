#!/usr/bin/env bash
# Export the retrieval embedder from the IBM source weights to the ONNX
# layout that the app's embed worker (client/src/app/llm/embed_worker.ts)
# loads. We export the ONNX files ourselves, from the IBM repo at a pinned
# revision, so the supply chain is IBM -> this script -> our HF repo. No
# third-party conversion is involved.
#
#   1. optimum fp32 export (task feature-extraction)
#   2. quantize.py: dynamic int8 (q8) -> onnx/model_quantized.onnx
#   3. verify.py:   q8 CLS vectors against the PyTorch fp32 reference
#
# Usage: ./export.sh
# Then:  node verify.mjs      (the app's transformers.js loads the export)
#        ./publish_hf.sh <hf user>
set -euo pipefail
cd "$(dirname "$0")"
unset VIRTUAL_ENV  # uv warns about an unrelated active virtualenv

# Single source for the upstream pin. Change both together.
upstream="ibm-granite/granite-embedding-small-english-r2"
revision="2ab6fa8ea2d674564defd37171ae19079b864b33"

onnx_env="../finetune/pipeline/onnx"
run="$PWD/runs/granite-embedding-small-english-r2"
src="$run/source"
raw="$run/onnx-fp32"
dst="$run/onnx"

rm -rf "$raw" "$dst"
mkdir -p "$run"
uv run --project "$onnx_env" hf download "$upstream" --revision "$revision" --local-dir "$src" >/dev/null
printf '{"upstream": "%s", "revision": "%s"}\n' "$upstream" "$revision" > "$run/source.json"

uv run --project "$onnx_env" optimum-cli export onnx --model "$src" --task feature-extraction "$raw"
uv run --project "$onnx_env" python quantize.py --src "$raw" --dst "$dst"
# The pooling config tells transformers.js nothing (the app passes pooling
# "cls" itself), but keep it with the export as documentation.
mkdir -p "$dst/1_Pooling"
cp "$src/1_Pooling/config.json" "$dst/1_Pooling/config.json"
rm -rf "$raw"
uv run --project "$onnx_env" python verify.py --src "$src" --onnx "$dst/onnx/model_quantized.onnx"
(cd "$dst" && sha256sum config.json tokenizer.json tokenizer_config.json special_tokens_map.json onnx/*)
