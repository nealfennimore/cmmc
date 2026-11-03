#!/usr/bin/env python3
"""
LoRA SFT of one app model on the CMMC dataset (transformers Trainer + PEFT).

    uv run train.py --model llama-3.2-1b-instruct
    uv run train.py --model gemma-3-270m-it --limit 200 --epochs 0.2   # smoke test

The training loop follows modules/finetune/scripts/train.py, which was
verified on the RTX 4070 Ti: each row renders with the model's own chat
template, and loss applies to the final assistant turn only.

Writes runs/<model>/adapter, run.json, and log_history.json.
"""
import argparse
import json
import os
import random
import time
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model
from transformers import (AutoModelForCausalLM, AutoTokenizer, DataCollatorForSeq2Seq, Trainer,
                          TrainingArguments)

from presets import PRESETS

HERE = Path(__file__).resolve().parent
TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True, choices=sorted(PRESETS))
ap.add_argument("--data", type=Path, default=HERE.parent / "rev3" / "out_combined")
ap.add_argument("--runs", type=Path, default=HERE / "runs")
ap.add_argument("--epochs", type=float, default=2)
ap.add_argument("--max-seq-len", type=int, default=1536)  # longest row is about 1.2k tokens
ap.add_argument("--no-system", action="store_true", help="drop the dataset system prompt")
ap.add_argument("--general", type=Path,
                help="extra JSONL of general chat rows ({messages: [...]}) to reduce forgetting")
ap.add_argument("--limit", type=int, help="use only N train rows (smoke test)")
ap.add_argument("--seed", type=int, default=7)
args = ap.parse_args()

p = PRESETS[args.model]
out = args.runs / args.model
out.mkdir(parents=True, exist_ok=True)
torch.manual_seed(args.seed)

tok = AutoTokenizer.from_pretrained(p["base"])
if tok.pad_token is None:
    # Safe here: labels are built explicitly below, and the collator pads labels with -100.
    tok.pad_token = tok.eos_token


def end_of_turn():
    """The text that the chat template appends after assistant content."""
    marker = "ZZEOTPROBEZZ"
    full = tok.apply_chat_template([{"role": "user", "content": "hi"},
                                    {"role": "assistant", "content": marker}], tokenize=False)
    return full[full.rfind(marker) + len(marker):].rstrip("\n")


EOT = end_of_turn()
print(f"end of turn text: {EOT!r}")


def render(messages):
    if args.no_system:
        messages = [m for m in messages if m["role"] != "system"]
    assert messages[-1]["role"] == "assistant"
    prompt = tok.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True)
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    c_ids = tok(messages[-1]["content"] + EOT, add_special_tokens=False)["input_ids"]
    ids = (p_ids + c_ids)[: args.max_seq_len]
    labels = ([-100] * len(p_ids) + c_ids)[: args.max_seq_len]
    return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels,
            "truncated": len(p_ids) + len(c_ids) > args.max_seq_len}


def read(path):
    return [json.loads(line)["messages"] for line in open(path)]


train_msgs, valid_msgs = read(args.data / "train.jsonl"), read(args.data / "valid.jsonl")
if args.limit:
    train_msgs, valid_msgs = train_msgs[: args.limit], valid_msgs[: max(16, args.limit // 10)]
if args.general:
    extra = read(args.general)
    train_msgs += extra
    random.Random(args.seed).shuffle(train_msgs)
    print(f"mixed in {len(extra)} general rows")

train_ds = Dataset.from_list([render(m) for m in train_msgs])
valid_ds = Dataset.from_list([render(m) for m in valid_msgs])
truncated = sum(train_ds["truncated"])
if truncated:
    print(f"warning: {truncated} train rows truncated at {args.max_seq_len} tokens")
train_ds, valid_ds = train_ds.remove_columns(["truncated"]), valid_ds.remove_columns(["truncated"])
print(f"train {len(train_ds)}  valid {len(valid_ds)}")

model = AutoModelForCausalLM.from_pretrained(p["base"], dtype=torch.bfloat16, device_map="auto",
                                             attn_implementation=p["attn"])
if p["grad_ckpt"]:
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
model = get_peft_model(model, LoraConfig(r=p["lora_r"], lora_alpha=2 * p["lora_r"], lora_dropout=0.05,
                                         target_modules=TARGETS, task_type="CAUSAL_LM"))
model.print_trainable_parameters()

# transformers 5 has no logging_dir argument; the TensorBoard callback reads this variable.
os.environ.setdefault("TENSORBOARD_LOGGING_DIR", str(out / "logs"))
targs = TrainingArguments(
    output_dir=str(out / "checkpoints"),
    per_device_train_batch_size=p["batch"],
    per_device_eval_batch_size=p["batch"],
    gradient_accumulation_steps=p["grad_accum"],
    num_train_epochs=args.epochs,
    learning_rate=p["lr"],
    lr_scheduler_type="cosine",
    warmup_steps=0.03,  # a float is a ratio of total steps in transformers 5
    bf16=True,
    logging_steps=20,
    report_to=["tensorboard"],
    eval_strategy="epoch",
    save_strategy="epoch",
    save_total_limit=2,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    seed=args.seed,
)
trainer = Trainer(model=model, args=targs, train_dataset=train_ds, eval_dataset=valid_ds,
                  data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100))

start = time.time()
result = trainer.train()
final_eval = trainer.evaluate()
model.save_pretrained(out / "adapter")
(out / "log_history.json").write_text(json.dumps(trainer.state.log_history, indent=2) + "\n")
summary = {
    "args": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
    "preset": p,
    "end_of_turn": EOT,
    "train_rows": len(train_ds),
    "train_loss": round(result.training_loss, 4),
    "eval_loss": round(final_eval["eval_loss"], 4),
    "minutes": round((time.time() - start) / 60, 1),
}
(out / "run.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
