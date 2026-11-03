#!/usr/bin/env bash
# Train, merge, evaluate, and export one model end to end.
#
# Usage: ./run_all.sh <model id> [extra train.py args]
#   ./run_all.sh gemma-3-270m-it --data data/mix     (after gen_drafts.py and build_mix.py)
# Run inside the modules/finetune dev shell. Stop Ollama first (VRAM).
set -euo pipefail
cd "$(dirname "$0")"
model="${1:?usage: $0 <model id> [train args]}"; shift
# Row lengths vary from tens to about 1.2k tokens, so the allocator fragments.
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"

# Re-score the base model when its report predates the current draft suite.
grep -q '"pass_rate"' "runs/$model/eval/base.json" 2>/dev/null || uv run evaluate.py --model "$model" --which base
uv run train.py --model "$model" "$@"
uv run merge.py --model "$model"
uv run evaluate.py --model "$model" --which tuned
uv run python compare.py --model "$model"
./export_onnx.sh "$model"
node verify_onnx.mjs "$model"
./export_gguf.sh "$model"
