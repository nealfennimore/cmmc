#!/usr/bin/env python3
"""
Quantize an fp32 optimum export into the file layout of the onnx-community
repos that the app pins today:

  q8     onnx/model_quantized.onnx + model_quantized.onnx_data   (Gemma 3 270M)
  q4f16  onnx/model_q4f16.onnx     + model_q4f16.onnx_data       (Llama 3.2 1B / 3B)

q4f16 follows the transformers.js recipe (onnx_float16.py is its converter):
4-bit MatMulNBits weights (block 32, symmetric), then float16 for the rest of
the graph except the default blocked ops and the graph inputs and outputs. The app derives use_external_data_format from the count of
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
    # The transformers.js recipe (scripts/quantize.py, mode q4f16): 4-bit
    # MatMulNBits on the fp32 graph, then its own float16 converter with the
    # default op block list and float32 graph inputs and outputs. Earlier
    # attempts with onnxconverter-common produced graphs that ONNX Runtime
    # rejected (mixed float/float16 types, then a broken RMSNorm fusion).
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

    import onnx_float16

    model = onnx.load(str(src_model))
    q = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True)
    q.process()
    model = q.model.model
    model = onnx_float16.convert_float_to_float16(
        model, keep_io_types=True, disable_shape_infer=model.ByteSize() >= onnx.checker.MAXIMUM_PROTOBUF,
        op_block_list=list(onnx_float16.DEFAULT_OP_BLOCK_LIST))

# onnx.save_model appends to an existing external-data file instead of
# replacing it, so each rerun into the same directory grew the file by one
# model (1.22, then 2.44, then 3.66 GB). Remove the old output first.
for old in (out_path, out_path.with_name(f"{out_name}_data")):
    old.unlink(missing_ok=True)

onnx.save_model(model, str(out_path), save_as_external_data=True, all_tensors_to_one_file=True,
                location=f"{out_name}_data", size_threshold=1024)
sizes = {p.name: p.stat().st_size for p in (args.dst / "onnx").iterdir()}
# A 4-bit or 8-bit file is well under half of the fp32 export. The second
# q4f16 attempt wrote 2.44 GB for the 1B (fp16 size), so check it.
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
