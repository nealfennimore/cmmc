#!/usr/bin/env python3
"""
Merge the Rev 2 (out/) and Rev 3 (out_r3/) datasets into one, with a single shared system
prompt, so one model can be trained on both revisions.

    python3 combine.py out out_r3 out_combined
"""
import json
import random
import sys
from pathlib import Path

SYSTEM = (
    "You are a CMMC and NIST SP 800-171 assistant. You cover Rev. 2 (the current CMMC Level 2 baseline, "
    "with the CMMC Assessment Guide – Level 2) and Rev. 3 (with SP 800-171A Rev. 3 and the DoD "
    "organization-defined parameter values). Rev. 2 IDs look like 3.1.1 or AC.L2-3.1.1; Rev. 3 IDs look "
    "like 03.01.01. Answer accurately and concisely, and say so if a requirement or identifier does not exist."
)

r2, r3, out = (Path(p) for p in sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
rng = random.Random(7)
for name in ("train", "valid", "test", "mcq_eval"):
    rows = []
    for src, rev in ((r2, 2), (r3, 3)):
        for line in open(src / f"{name}.jsonl"):
            row = json.loads(line)
            row["messages"][0]["content"] = SYSTEM
            row["meta"]["rev"] = rev
            rows.append(row)
    rng.shuffle(rows)
    with open(out / f"{name}.jsonl", "w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(name, len(rows))
with open(out / "corpus.jsonl", "w") as fh:
    for src, rev in ((r2, 2), (r3, 3)):
        for line in open(src / "corpus.jsonl"):
            d = json.loads(line)
            d["rev"] = rev
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")
