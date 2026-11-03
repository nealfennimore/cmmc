#!/usr/bin/env python3
"""
Quantize an fp32 optimum export into the file layout of the onnx-community
repos that the app pins today:

  q8     onnx/model_quantized.onnx + model_quantized.onnx_data   (Gemma 3 270M)
  q4f16  onnx/model_q4f16.onnx     + model_q4f16.onnx_data       (Llama 3.2 1B / 3B)

q4f16 follows the transformers.js recipe: 4-bit MatMulNBits weights (block
32, symmetric), then the rest of the graph, including logits and the KV
cache, in fp16. The app derives use_external_data_format from the count of
.onnx_data files in the manifest, so this script always writes exactly one.

    uv run --project onnx python quantize_onnx.py --src runs/X/onnx-fp32 --dst runs/X/onnx --dtype q4f16
"""
import argparse
import shutil
import tempfile
from pathlib import Path

import onnx

ap = argparse.ArgumentParser()
ap.add_argument("--src", type=Path, required=True)
ap.add_argument("--dst", type=Path, required=True)
ap.add_argument("--dtype", choices=["q8", "q4f16"], required=True)
args = ap.parse_args()

suffix = {"q8": "quantized", "q4f16": "q4f16"}[args.dtype]
(args.dst / "onnx").mkdir(parents=True, exist_ok=True)
for f in args.src.iterdir():
    if f.suffix == ".json" or f.name.endswith(".model"):
        shutil.copy2(f, args.dst / f.name)

src_model = args.src / "model.onnx"
out_name = f"model_{suffix}.onnx"
out_path = args.dst / "onnx" / out_name

if args.dtype == "q8":
    from onnxruntime.quantization import QuantType, quantize_dynamic

    with tempfile.TemporaryDirectory() as tmp:
        tmp_out = Path(tmp) / out_name
        quantize_dynamic(src_model, tmp_out, weight_type=QuantType.QInt8, per_channel=False,
                         op_types_to_quantize=["MatMul", "Gather"], use_external_data_format=True)
        model = onnx.load(str(tmp_out))
else:
    from onnxconverter_common import float16
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

    model = onnx.load(str(src_model))
    q = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True)
    q.process()
    model = q.model.model
    model = float16.convert_float_to_float16(model, keep_io_types=False, disable_shape_infer=True)

onnx.save_model(model, str(out_path), save_as_external_data=True, all_tensors_to_one_file=True,
                location=f"{out_name}_data", size_threshold=1024)
sizes = {p.name: p.stat().st_size for p in (args.dst / "onnx").iterdir()}
print(f"wrote {args.dst}: {sizes}")
