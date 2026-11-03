#!/usr/bin/env bash
# Export runs/<model>/merged to the ONNX layout that the app's transformers.js
# worker loads: config, tokenizer, and onnx/model_<suffix>.onnx with a single
# onnx/model_<suffix>.onnx_data external-data file.
#
# Usage: ./export_onnx.sh <model id>
#
# Then gate the result with: node verify_onnx.mjs <model id>
set -euo pipefail
cd "$(dirname "$0")"

model="${1:?usage: $0 <model id>}"
dtype="$(uv run python -c "from presets import PRESETS; print(PRESETS['$model']['onnx_dtype'])")"
run="$PWD/runs/$model"
raw="$run/onnx-fp32"
dst="$run/onnx"

rm -rf "$raw" "$dst"
uv run --project onnx optimum-cli export onnx --model "$run/merged" --task text-generation-with-past "$raw"
uv run --project onnx python quantize_onnx.py --src "$raw" --dst "$dst" --dtype "$dtype"
uv run --project onnx python inline_chat_template.py "$run/merged" "$dst"
rm -rf "$raw"
(cd "$dst" && sha256sum onnx/*)
