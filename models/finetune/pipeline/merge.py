#!/usr/bin/env python3
"""
Merge the LoRA adapter into the base weights: runs/<model>/merged.
The GGUF and ONNX exports read this directory.

    python merge.py --model llama-3.2-1b-instruct
"""
import argparse
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig

from presets import PRESETS

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True, choices=sorted(PRESETS))
ap.add_argument("--runs", default=str(HERE / "runs"))
args = ap.parse_args()

p = PRESETS[args.model]
run = Path(args.runs) / args.model
dst = run / "merged"

base = AutoModelForCausalLM.from_pretrained(p["base"], dtype=torch.bfloat16)
model = PeftModel.from_pretrained(base, str(run / "adapter")).merge_and_unload()
model.save_pretrained(str(dst), safe_serialization=True)
# Ship the base tokenizer and generation config unchanged, so that the chat
# template and stop tokens match the upstream model the app already uses.
AutoTokenizer.from_pretrained(p["base"]).save_pretrained(str(dst))
GenerationConfig.from_pretrained(p["base"]).save_pretrained(str(dst))
print(f"merged model saved to {dst}")
