#!/usr/bin/env python3
"""Print base vs tuned scores for one model and the ship verdict.

    uv run python compare.py --model llama-3.2-1b-instruct
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--runs", type=Path, default=HERE / "runs")
ap.add_argument("--tag", default="", help="compare eval/base<tag>.json with eval/tuned<tag>.json")
args = ap.parse_args()
d = args.runs / args.model / "eval"
b, t = (json.loads((d / f"{w}{args.tag}.json").read_text()) for w in ("base", "tuned"))

rows = [
    *([("mcq accuracy", b["mcq"]["overall"], t["mcq"]["overall"], "up")] if "mcq" in b and "mcq" in t else []),
    *([("recall token F1", b["recall"]["f1"], t["recall"]["f1"], "up")] if "recall" in b and "recall" in t else []),
    ("draft pass rate", b["draft"]["pass_rate"], t["draft"]["pass_rate"], "up"),
    ("draft leak rate", b["draft"]["leak_rate"], t["draft"]["leak_rate"], "down"),
    ("draft ungrounded/draft", b["draft"]["ungrounded_per_draft"], t["draft"]["ungrounded_per_draft"], "down"),
]
for name, x, y, better in rows:
    print(f"{name:24s} {x:7.3f} -> {y:7.3f}  ({better} is better)")
for src in ("fixture", "heldout"):
    bs, ts = b["draft"]["by_source"][src], t["draft"]["by_source"][src]
    if ts["n"]:
        print(f"  draft pass, {src:8s} {bs['pass_rate']:7.3f} -> {ts['pass_rate']:7.3f}  (n={ts['n']})")

# Ship criteria (README.md): the app task is the gate. Lookup gains alone do not ship.
ok = (t["draft"]["pass_rate"] > b["draft"]["pass_rate"]
      and t["draft"]["leak_rate"] <= b["draft"]["leak_rate"]
      and t["draft"]["ungrounded_per_draft"] <= b["draft"]["ungrounded_per_draft"])
print("verdict:", "PASS (still read the drafts in eval/tuned.json)" if ok else "FAIL: do not publish")
# A non-zero exit stops run_all.sh before it exports a model that must not ship.
raise SystemExit(0 if ok else 1)
