#!/usr/bin/env python3
"""
Quantize an fp32 optimum export into the file layout of the onnx-community
repo that the app pins today:

  q8     onnx/model_quantized.onnx + model_quantized.onnx_data   (Gemma 3 270M)

q4f16 (Llama 3.2 1B / 3B) does not use this script: see build_q4f16.py. The
app derives use_external_data_format from the count of .onnx_data files in
the manifest, so this script always writes exactly one.

    uv run --project onnx python quantize_onnx.py --src runs/X/onnx-fp32 --dst runs/X/onnx --dtype q8
"""
import argparse
import shutil
import tempfile
from pathlib import Path

import onnx

ap = argparse.ArgumentParser()
ap.add_argument("--src", type=Path, required=True)
ap.add_argument("--dst", type=Path, required=True)
ap.add_argument("--dtype", choices=["q8"], required=True)
args = ap.parse_args()

suffix = "quantized"
(args.dst / "onnx").mkdir(parents=True, exist_ok=True)
for f in args.src.iterdir():
    if f.suffix == ".json" or f.name.endswith(".model"):
        shutil.copy2(f, args.dst / f.name)

src_model = args.src / "model.onnx"
out_name = f"model_{suffix}.onnx"
out_path = args.dst / "onnx" / out_name

from onnxruntime.quantization import QuantType, quantize_dynamic

with tempfile.TemporaryDirectory() as tmp:
    tmp_out = Path(tmp) / out_name
    quantize_dynamic(src_model, tmp_out, weight_type=QuantType.QInt8, per_channel=False,
                     op_types_to_quantize=["MatMul", "Gather"], use_external_data_format=True)
    model = onnx.load(str(tmp_out))

# onnx.save_model appends to an existing external-data file instead of
# replacing it, so each rerun into the same directory grew the file by one
# model (1.22, then 2.44, then 3.66 GB). Remove the old output first.
for old in (out_path, out_path.with_name(f"{out_name}_data")):
    old.unlink(missing_ok=True)

onnx.save_model(model, str(out_path), save_as_external_data=True, all_tensors_to_one_file=True,
                location=f"{out_name}_data", size_threshold=1024)
sizes = {p.name: p.stat().st_size for p in (args.dst / "onnx").iterdir()}
# An 8-bit file is well under half of the fp32 export.
fp32_bytes = sum(p.stat().st_size for p in args.src.iterdir() if p.name.startswith("model.onnx"))
out_bytes = sum(sizes.values())
print(f"size: {out_bytes / 1e9:.2f} GB, {out_bytes / fp32_bytes:.0%} of the fp32 export")
if out_bytes > 0.45 * fp32_bytes:
    raise SystemExit("the quantized model is too large: the weights did not quantize")
# Fail here, not in the app: ONNX Runtime rejects type mismatches at load time.
import onnxruntime
onnxruntime.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
print("onnxruntime loads the model")
print(f"wrote {args.dst}: {sizes}")
