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
from pathlib import Path

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--draft", type=Path, default=HERE / "data" / "draft")
ap.add_argument("--lookup", type=Path, default=HERE.parent / "rev3" / "out_combined")
ap.add_argument("--out", type=Path, default=HERE / "data" / "mix")
ap.add_argument("--lookup-ratio", type=float, default=0.5)
args = ap.parse_args()

rng = random.Random(7)
args.out.mkdir(parents=True, exist_ok=True)
for split in ("train", "valid"):
    draft = [json.loads(l) for l in open(args.draft / f"{split}.jsonl")]
    lookup = [json.loads(l) for l in open(args.lookup / f"{split}.jsonl")]
    rng.shuffle(lookup)
    rows = [{"messages": r["messages"], "meta": r["meta"]} for r in draft]
    rows += lookup[: int(len(draft) * args.lookup_ratio)]
    rng.shuffle(rows)
    with open(args.out / f"{split}.jsonl", "w") as fh:
        fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    print(f"{split}: {len(draft)} draft + {len(rows) - len(draft)} lookup = {len(rows)}")
