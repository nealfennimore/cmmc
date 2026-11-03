#!/usr/bin/env python3
"""
Minimal LoRA SFT on the generated CMMC data with Hugging Face TRL.

    pip install "trl>=0.20" peft datasets transformers accelerate
    python train_sft.py --model Qwen/Qwen2.5-0.5B-Instruct --data out --output cmmc-lora

Tested-for-shape only (not run on a GPU here). Adjust batch size / max_length for your card.
"""
import argparse

from datasets import load_dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
ap.add_argument("--data", default="out")
ap.add_argument("--output", default="cmmc-lora")
ap.add_argument("--epochs", type=float, default=3)
ap.add_argument("--lr", type=float, default=2e-4)
ap.add_argument("--no-system", action="store_true", help="drop the system message from every example")
args = ap.parse_args()

ds = load_dataset("json", data_files={"train": f"{args.data}/train.jsonl",
                                      "validation": f"{args.data}/valid.jsonl"})
ds = ds.remove_columns(["meta"])  # keep only "messages"
if args.no_system:
    ds = ds.map(lambda ex: {"messages": [m for m in ex["messages"] if m["role"] != "system"]})

cfg = SFTConfig(
    output_dir=args.output,
    num_train_epochs=args.epochs,
    learning_rate=args.lr,
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    max_length=1536,            # longest example is ~1.2k tokens
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    logging_steps=20,
    eval_strategy="steps",
    eval_steps=200,
    save_strategy="steps",
    save_steps=200,
    save_total_limit=2,
    bf16=True,
    report_to="none",
)

peft_cfg = LoraConfig(r=32, lora_alpha=64, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")

trainer = SFTTrainer(model=args.model, args=cfg, train_dataset=ds["train"],
                     eval_dataset=ds["validation"], peft_config=peft_cfg)
trainer.train()
trainer.save_model(args.output)
