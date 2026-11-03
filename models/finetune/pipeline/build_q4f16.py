#!/usr/bin/env python3
"""
Build the q4f16 ONNX export of a merged Llama with the ONNX Runtime GenAI
model builder, the tool that made the onnx-community Llama 3.2 q4f16 files
that the app pins today. Then write it in the layout that the app loads:

  config.json, generation_config.json         (from the merged directory)
  onnx/model_q4f16.onnx                       graph, no weights
  onnx/model_q4f16.onnx_data[, _data_1, ...]  weights, each shard < 2 GiB

    uv run --project onnx python build_q4f16.py --merged runs/X/merged --dst runs/X/onnx

Why not optimum plus onnx_float16.py: that path wrote an unfused graph
(1,467 Constant and 351 Cast nodes, attention as plain ops). ONNX Runtime
1.24 (client/node_modules/onnxruntime-node) could not load it at the
default optimization level: SimplifiedLayerNormFusion referenced a cast
that it had deleted. The builder writes the fused graph (GroupQueryAttention,
SkipSimplifiedLayerNormalization, MatMulNBits) that upstream ships, and it
converts one layer at a time, so the 3B fits in memory.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import onnx
from onnx.external_data_helper import _get_all_tensors, uses_external_data

# The op types in the pinned onnx-community Llama 3.2 1B and 3B q4f16 graphs.
# The app runs these through onnxruntime-web (WebGPU). An op outside this set
# can have no WebGPU kernel, and verify_onnx.mjs (CPU) would not see that.
UPSTREAM_OPS = {
    "MatMulNBits", "SkipSimplifiedLayerNormalization", "SimplifiedLayerNormalization",
    "GroupQueryAttention", "Mul", "Sigmoid", "Cast", "Constant", "Gather",
    "ReduceSum", "Sub", "Shape", "Transpose", "MatMul",
    # onnxruntime-genai 0.19 packs q/k/v and gate/up into one MatMulNBits
    # each and splits the result. Split is a core ONNX op with a WebGPU kernel.
    "Split",
}
# transformers.js fetches onnx_data, onnx_data_1, ... Upstream 3B shards stay
# under 2 GiB (2,095,929,344 bytes): browsers reject larger ArrayBuffers.
SHARD_LIMIT = 2_000_000_000
ALIGN = 4096

ap = argparse.ArgumentParser()
ap.add_argument("--merged", type=Path, required=True)
ap.add_argument("--dst", type=Path, required=True)
ap.add_argument("--extra-options", default=os.environ.get("BUILDER_EXTRA_OPTIONS", ""),
                help="more builder --extra_options, space separated (env BUILDER_EXTRA_OPTIONS)")
args = ap.parse_args()

name = "model_q4f16.onnx"
(args.dst / "onnx").mkdir(parents=True, exist_ok=True)
for old in (args.dst / "onnx").glob(f"{name}*"):
    old.unlink()

with tempfile.TemporaryDirectory(dir=args.dst.parent) as tmp:
    out, cache, stage = Path(tmp) / "out", Path(tmp) / "cache", Path(tmp) / "merged"
    # The merged directory comes from transformers 5, and its
    # tokenizer_config.json names the class "TokenizersBackend". The builder
    # runs on the transformers 4 of the onnx environment, which does not know
    # that class. Give the builder symlinks to the merged files and a
    # tokenizer_config.json with the transformers 4 name. The merged directory
    # stays unchanged. The builder only reads the tokenizer: the app tokenizer
    # files come from the merged directory (inline_chat_template.py).
    stage.mkdir()
    for f in args.merged.iterdir():
        (stage / f.name).symlink_to(f.resolve())
    tok = json.loads((args.merged / "tokenizer_config.json").read_text())
    if tok.get("tokenizer_class") == "TokenizersBackend":
        tok["tokenizer_class"] = "PreTrainedTokenizerFast"
        tok.pop("backend", None)
        (stage / "tokenizer_config.json").unlink()
        (stage / "tokenizer_config.json").write_text(json.dumps(tok, indent=2) + "\n")
    # transformers 5 writes RoPE as "rope_parameters". transformers 4 reads
    # "rope_theta" and "rope_scaling", and without them it falls back to
    # theta 10000 with no llama3 scaling: a wrong model, with no error.
    cfg = json.loads((args.merged / "config.json").read_text())
    rope = cfg.pop("rope_parameters", None)
    if rope is not None:
        rope = dict(rope)
        cfg["rope_theta"] = rope.pop("rope_theta")
        cfg["rope_scaling"] = rope if rope.get("rope_type", "default") != "default" else None
        cfg.setdefault("torch_dtype", cfg.get("dtype"))
        (stage / "config.json").unlink()
        (stage / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
        print(f"builder config: rope_theta={cfg['rope_theta']} rope_scaling={cfg['rope_scaling']}")
    # -e webgpu: fp16 activations and KV cache, like upstream.
    # hf_token=false: read only the local merged directory.
    # shared_embeddings=false: the builder turns sharing on for tied
    # embeddings (Llama 3.2) and then emits GatherBlockQuantized, which the
    # upstream graphs do not use. Without sharing: an fp16 Gather for the
    # embeddings and a MatMulNBits LM head, both in UPSTREAM_OPS.
    extra = ["hf_token=false", "shared_embeddings=false", *args.extra_options.split()]
    cmd = [sys.executable, "-m", "onnxruntime_genai.models.builder", "-i", str(stage),
           "-o", str(out), "-p", "int4", "-e", "webgpu", "-c", str(cache), "--extra_options", *extra]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)

    graphs = list(out.glob("*.onnx"))
    if len(graphs) != 1:
        raise SystemExit(f"expected one .onnx file in the builder output, found {graphs}")
    model = onnx.load(str(graphs[0]), load_external_data=False)

    # Rewrite the external data into the app's shard names. Tensor bytes are
    # copied as they are, so no weights pass through protobuf (2 GB limit).
    shards, cur, pos = [], None, 0
    def next_shard():
        global cur, pos
        if cur:
            cur.close()
        shard = name + "_data" + (f"_{len(shards)}" if shards else "")
        shards.append(shard)
        cur, pos = open(args.dst / "onnx" / shard, "wb"), 0
    next_shard()
    sources = {}
    for t in _get_all_tensors(model):
        if not uses_external_data(t):
            continue
        info = {e.key: e.value for e in t.external_data}
        src = sources.get(info["location"])
        if src is None:
            src = sources[info["location"]] = open(out / info["location"], "rb")
        length = int(info["length"])
        start = -(-pos // ALIGN) * ALIGN if length >= ALIGN else pos
        if start + length > SHARD_LIMIT and pos > 0:
            next_shard()
            start = 0
        if length > SHARD_LIMIT:
            raise SystemExit(f"tensor {t.name} is {length} bytes: larger than one shard")
        src.seek(int(info.get("offset", 0)))
        cur.write(b"\0" * (start - pos))
        cur.write(src.read(length))
        pos = start + length
        del t.external_data[:]
        for k, v in (("location", shards[-1]), ("offset", str(start)), ("length", str(length))):
            e = t.external_data.add()
            e.key, e.value = k, v
    cur.close()
    for f in sources.values():
        f.close()

    # Make the inputs and outputs the same as upstream. transformers.js
    # builds the empty KV cache from the input shapes, and it sets unknown
    # symbols to 0. onnxruntime-genai 0.19 writes the head size as the symbol
    # "kv_cache_dim", which gave [1, 8, 0, 0] and a GroupQueryAttention error.
    # Upstream has the number (64 for Llama 3.2).
    mcfg = json.loads((args.merged / "config.json").read_text())
    head_dim = mcfg.get("head_dim") or mcfg["hidden_size"] // mcfg["num_attention_heads"]
    for vi in [*model.graph.input, *model.graph.output, *model.graph.value_info]:
        for d in vi.type.tensor_type.shape.dim:
            if d.dim_param == "kv_cache_dim":
                d.ClearField("dim_param")
                d.dim_value = head_dim
    known = {"batch_size", "sequence_length", "past_sequence_length", "total_sequence_length"}
    for vi in [*model.graph.input, *model.graph.output]:
        extra = {d.dim_param for d in vi.type.tensor_type.shape.dim if d.dim_param} - known
        if extra:
            raise SystemExit(f"{vi.name} has shape symbols {sorted(extra)} that upstream does not use: "
                             "transformers.js would set them to 0")
    # Upstream casts the logits to float32 at the end of the graph. Do the
    # same, so that the app gets the logits type that it has today.
    from onnx import TensorProto, helper
    logits = next(o for o in model.graph.output if o.name == "logits")
    if logits.type.tensor_type.elem_type != TensorProto.FLOAT:
        for n in model.graph.node:
            n.output[:] = ["logits_fp16" if o == "logits" else o for o in n.output]
        model.graph.node.append(helper.make_node("Cast", ["logits_fp16"], ["logits"],
                                                 to=TensorProto.FLOAT, name="/lm_head/CastToFloat32"))
        logits.type.tensor_type.elem_type = TensorProto.FLOAT
    onnx.save_model(model, str(args.dst / "onnx" / name))

ops = Counter(n.op_type for n in model.graph.node)
print("ops:", dict(ops.most_common()))
unknown = set(ops) - UPSTREAM_OPS
if unknown:
    raise SystemExit(f"op types that the upstream graphs do not use: {sorted(unknown)}. "
                     "The app's WebGPU runtime can lack kernels for them. Do not ship.")

# Config and tokenizer come from the merged weights, as in the optimum path.
for f in ("config.json", "generation_config.json"):
    shutil.copy2(args.merged / f, args.dst / f)
cfg_path = args.dst / "config.json"
cfg = json.loads(cfg_path.read_text())
# The same block as upstream: transformers.js must make an fp16 KV cache,
# and it must fetch every weight shard.
cfg["transformers.js_config"] = {
    "use_external_data_format": {name: len(shards)},
    "kv_cache_dtype": {"q4f16": "float16"},
}
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")

sizes = {p.name: p.stat().st_size for p in sorted((args.dst / "onnx").iterdir())}
print(f"shards: {len(shards)}, size: {sum(sizes.values()) / 1e9:.2f} GB")
# The default level (ORT_ENABLE_ALL) is the one that rejected the optimum graph.
import onnxruntime
onnxruntime.InferenceSession(str(args.dst / "onnx" / name), providers=["CPUExecutionProvider"])
print("onnxruntime loads the model")
print(f"wrote {args.dst}: {sizes}")
