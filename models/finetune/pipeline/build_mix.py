#!/usr/bin/env python3
"""
Mix the draft-task data with a smaller share of the lookup Q&A, so that the
model learns the app task first and the facts second.

    python3 build_mix.py --lookup-ratio 0.5      # 1 lookup row per 2 draft rows
    uv run train.py --model gemma-3-270m-it --data data/mix

The first Gemma run trained on lookup rows only and then answered every
draft prompt in the lookup answer template. Keep the ratio at or below 1.
"""
import argparse
import json
import random
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--draft", type=Path, default=HERE / "data" / "draft")
ap.add_argument("--lookup", type=Path, default=HERE.parent / "rev3" / "out_combined")
ap.add_argument("--out", type=Path, default=HERE / "data" / "mix")
ap.add_argument("--lookup-ratio", type=float, default=0.5)
ap.add_argument("--max-words", type=int, default=90,
                help="trim draft answers to whole sentences within N words (0: no trim). The teacher "
                     "wrote 96-120 words for every row, and the first Gemma run learned to overshoot "
                     "the app's 120-word limit.")
args = ap.parse_args()

# A sentence ends at . ! ? followed by whitespace, except after common abbreviations.
SENT_END = re.compile(r"(?<!\be\.g)(?<!\bi\.e)(?<!\betc)(?<!\bInc)(?<!\bNo)(?<=[.!?])\s+")


def trim(text, max_words):
    """Keep whole sentences, in order, up to max_words. None if the first sentence is too long."""
    out, words = [], 0
    for para in text.split("\n\n"):
        kept = []
        for sent in SENT_END.split(para.strip()):
            n = len(sent.split())
            if words + n > max_words:
                break
            kept.append(sent)
            words += n
        if kept:
            out.append(" ".join(kept))
        if len(kept) < len(SENT_END.split(para.strip())):
            break
    return "\n\n".join(out) if out else None


def shorten(row):
    if not args.max_words:
        return row
    text = trim(row["messages"][-1]["content"], args.max_words)
    if text is None:
        return None
    return {**row, "messages": row["messages"][:-1] + [{"role": "assistant", "content": text}]}

rng = random.Random(7)
args.out.mkdir(parents=True, exist_ok=True)
for split in ("train", "valid"):
    draft = [json.loads(l) for l in open(args.draft / f"{split}.jsonl")]
    lookup = [json.loads(l) for l in open(args.lookup / f"{split}.jsonl")]
    rng.shuffle(lookup)
    draft = [d for d in (shorten({"messages": r["messages"], "meta": r["meta"]}) for r in draft) if d]
    rows = list(draft)
    rows += lookup[: int(len(draft) * args.lookup_ratio)]
    rng.shuffle(rows)
    with open(args.out / f"{split}.jsonl", "w") as fh:
        fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    print(f"{split}: {len(draft)} draft + {len(rows) - len(draft)} lookup = {len(rows)}")
