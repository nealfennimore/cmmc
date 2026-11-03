"""
Per-model settings for the three models that the app ships (see
client/src/app/llm/models.manifest.json). Batch sizes fit a 12 GB card
(RTX 4070 Ti). On a 16 GB card, double `batch` and halve `grad_accum`.

Effective batch size is batch * grad_accum = 16 for every model, so the
learning-rate and step counts compare across models.

LLAMA_MIRROR=unsloth swaps meta-llama/<repo> for unsloth/<repo>, an ungated
copy with the same weight files, while Meta access is pending. "upstream"
keeps the Meta name for the license notice and the model card.
"""
import os

PRESETS = {
    "gemma-3-270m-it": {
        "base": "google/gemma-3-270m-it",
        # Gemma Terms of Use: keep the "Gemma" name and the notice.
        "hub_name": "gemma-3-270m-it-CMMC",
        # Memory goes to logits, not weights: the 262k vocabulary costs about
        # 2.9 MB per token (bf16 logits, fp32 upcast for the loss, gradients),
        # measured on the 4070 Ti. The longest rows are about 1.4k Gemma tokens.
        # Batch 16 and batch 2 both ran out of memory (batch 2 at step 187).
        # Batch 1 peaks near 4.5 GB at the 1,536-token cap.
        "batch": 1,
        "grad_accum": 16,
        "lr": 2e-4,
        "lora_r": 32,
        "grad_ckpt": False,
        # Gemma 3 trains unstably with sdpa/flash attention; HF recommends eager.
        "attn": "eager",
        # The app runs Gemma only through ONNX (WASM lite model).
        "onnx_dtype": "q8",
        "gguf_quant": None,
    },
    "llama-3.2-1b-instruct": {
        "base": "meta-llama/Llama-3.2-1B-Instruct",
        # Llama 3.2 Community License 1.b.i: a derivative name must begin with "Llama".
        "hub_name": "Llama-3.2-1B-Instruct-CMMC",
        # 128k vocabulary: about 1.3 MB of logits memory per token. Draft rows
        # reach about 1.4k tokens. Batch 2 without checkpointing ran out of memory
        # on the 4070 Ti (10.3 GB allocated at step 0): logits plus the
        # activations of all 16 layers. Batch 1 with checkpointing fits.
        "batch": 1,
        "grad_accum": 16,
        "lr": 2e-4,
        "lora_r": 32,
        "grad_ckpt": True,
        "attn": "sdpa",
        "onnx_dtype": "q4f16",
        "gguf_quant": "Q4_K_M",
    },
    "llama-3.2-3b-instruct": {
        "base": "meta-llama/Llama-3.2-3B-Instruct",
        "hub_name": "Llama-3.2-3B-Instruct-CMMC",
        # Batch 2 needs about 4 GB of logits on the longest rows, on top of the
        # weights. That is more than 12 GB in total. Batch 1 halves the logits.
        "batch": 1,
        "grad_accum": 16,
        "lr": 1e-4,
        "lora_r": 16,
        # 6.4 GB of bf16 weights leaves little room for activations on 12 GB.
        "grad_ckpt": True,
        "attn": "sdpa",
        "onnx_dtype": "q4f16",
        "gguf_quant": "Q4_K_M",
    },
}


for _p in PRESETS.values():
    _p["upstream"] = _p["base"]
    if os.environ.get("LLAMA_MIRROR") and _p["base"].startswith("meta-llama/"):
        _p["base"] = _p["base"].replace("meta-llama/", os.environ["LLAMA_MIRROR"].strip("/") + "/", 1)
