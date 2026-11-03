#!/usr/bin/env bash
# Convert runs/<model>/merged to the GGUF file that the native desktop path loads.
#
# Usage: ./export_gguf.sh <model id> [quant]      (quant default: the preset's, Q4_K_M)
#
# Run inside the modules/finetune dev shell (nix develop ../../../modules/finetune).
# It exports LLAMA_CPP_SRC, the llama.cpp checkout that its flake.lock pins.
# llama-quantize comes from nixpkgs; set LLAMA_QUANTIZE to use another binary.
set -euo pipefail
cd "$(dirname "$0")"

model="${1:?usage: $0 <model id> [quant]}"
quant="${2:-$(uv run python -c "from presets import PRESETS; print(PRESETS['$model']['gguf_quant'] or '')")}"
[ -n "$quant" ] || { echo "$model has no GGUF in the app (ONNX only)"; exit 0; }
src="${LLAMA_CPP_SRC:?LLAMA_CPP_SRC is not set. Enter the modules/finetune dev shell first.}"
hub="$(uv run python -c "from presets import PRESETS; print(PRESETS['$model']['hub_name'])")"
run="runs/$model"
mkdir -p "$run/gguf"
f16="$run/gguf/$hub-f16.gguf"
out="$run/gguf/$hub-$quant.gguf"

uv run --group export python "$src/convert_hf_to_gguf.py" "$run/merged" --outfile "$f16" --outtype f16
if [ -n "${LLAMA_QUANTIZE:-}" ]; then
    "$LLAMA_QUANTIZE" "$f16" "$out" "$quant"
else
    nix shell nixpkgs#llama-cpp -c llama-quantize "$f16" "$out" "$quant"
fi
rm -f "$f16"
sha256sum "$out"
echo "converter: llama.cpp $(basename "$src")"
