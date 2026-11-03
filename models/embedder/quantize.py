#!/usr/bin/env python3
"""
Quantize the fp32 optimum export of the embedder to dynamic int8 (the
transformers.js "q8" dtype): onnx/model_quantized.onnx, as one file.

The model is about 47M parameters, far below the 2 GB protobuf limit, so the
export uses no external-data file. The app then loads it without
use_external_data_format.

    uv run --project ../finetune/pipeline/onnx python quantize.py --src runs/X/onnx-fp32 --dst runs/X/onnx
"""
import argparse
import shutil
from pathlib import Path

import onnxruntime
from onnxruntime.quantization import QuantType, quantize_dynamic

ap = argparse.ArgumentParser()
ap.add_argument("--src", type=Path, required=True)
ap.add_argument("--dst", type=Path, required=True)
args = ap.parse_args()

(args.dst / "onnx").mkdir(parents=True, exist_ok=True)
for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
    shutil.copy2(args.src / name, args.dst / name)

out_path = args.dst / "onnx" / "model_quantized.onnx"
out_path.unlink(missing_ok=True)
# MatMul and Gather, like quantize_onnx.py. Gather covers the token
# embedding table (about 50k x 384, 77 MB in fp32). Without it, the file is
# about twice as large. verify.py gates the quality loss.
quantize_dynamic(
    args.src / "model.onnx",
    out_path,
    weight_type=QuantType.QInt8,
    per_channel=False,
    op_types_to_quantize=["MatMul", "Gather"],
)

fp32_bytes = (args.src / "model.onnx").stat().st_size
out_bytes = out_path.stat().st_size
print(f"size: {out_bytes / 1e6:.1f} MB, {out_bytes / fp32_bytes:.0%} of the fp32 export")
if out_bytes > 0.45 * fp32_bytes:
    raise SystemExit("the quantized model is too large: the weights did not quantize")
onnxruntime.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
print(f"onnxruntime loads {out_path}")
