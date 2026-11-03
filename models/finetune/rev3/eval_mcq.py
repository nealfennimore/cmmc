#!/usr/bin/env python3
"""
Score a model (base or fine-tuned) on mcq_eval.jsonl by exact letter match.

    python eval_mcq.py --model Qwen/Qwen2.5-0.5B-Instruct                 # baseline
    python eval_mcq.py --model Qwen/Qwen2.5-0.5B-Instruct --adapter cmmc-lora
"""
import argparse
import collections
import json
import re

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--adapter")
ap.add_argument("--data", default="out/mcq_eval.jsonl")
ap.add_argument("--limit", type=int)
args = ap.parse_args()

tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.bfloat16, device_map="auto")
if args.adapter:
    from peft import PeftModel
    model = PeftModel.from_pretrained(model, args.adapter)
model.eval()

rows = [json.loads(l) for l in open(args.data)][: args.limit]
hits, totals = collections.Counter(), collections.Counter()
for row in rows:
    prompt = tok.apply_chat_template(row["messages"][:-1], tokenize=False, add_generation_prompt=True)
    ids = tok(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(**ids, max_new_tokens=4, do_sample=False)
    text = tok.decode(out[0, ids["input_ids"].shape[1]:], skip_special_tokens=True)
    m = re.search(r"[ABCD]", text)
    task = row["meta"]["task"]
    totals[task] += 1
    hits[task] += int(bool(m) and m.group(0) == row["answer"])

for t in sorted(totals):
    print(f"{t:24s} {hits[t]:4d}/{totals[t]:<4d} {hits[t] / totals[t]:.1%}")
print(f"{'overall':24s} {sum(hits.values()):4d}/{sum(totals.values()):<4d} {sum(hits.values()) / sum(totals.values()):.1%}")
