#!/usr/bin/env python3
"""
Re-run checks.py on the drafts saved in an eval report, without a GPU. Use
it after a change to checks.py, then run compare.py as usual.

    python3 rescore.py runs/gemma-3-270m-it/eval/base.json runs/gemma-3-270m-it/eval/tuned.json
"""
import collections
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import app_prompt  # noqa: E402
import checks  # noqa: E402


def chunk_lists(n_heldout):
    """The evidence for each case, in evaluate.py's order (draft_cases)."""
    by_req = collections.defaultdict(list)
    for c in app_prompt.focus_cases(2):
        by_req[c["requirementId"]].append(c)
    lists = [fx["chunks"] for fx in json.loads((HERE / "fixtures" / "draft_cases.json").read_text())
             for _ in by_req[fx["requirementId"]]]
    rows = [json.loads(line) for line in open(HERE / "data" / "draft" / "test.jsonl")]
    random.Random(7).shuffle(rows)
    return lists + [r["chunks"] for r in rows[:n_heldout]]


for path in sys.argv[1:]:
    report = json.loads(Path(path).read_text())
    cases = report["draft"]["cases"]
    chunks = chunk_lists(sum(c["source"] == "heldout" for c in cases))
    assert len(chunks) == len(cases), "test.jsonl changed since this eval ran"
    for case, ch in zip(cases, chunks):
        r = checks.check(case["output"], ch)
        case.update(r, **{"pass": checks.passes(r)})

    def summary(rs):
        n = len(rs) or 1
        return {"n": len(rs), "pass_rate": sum(r["pass"] for r in rs) / n,
                "leak_rate": sum(bool(r["id_leaks"] or r["term_leaks"]) for r in rs) / n,
                "ungrounded_per_draft": sum(len(r["ungrounded"]) for r in rs) / n}

    report["draft"].update(summary(cases))
    report["draft"]["by_source"] = {s: summary([c for c in cases if c["source"] == s]) for s in ("fixture", "heldout")}
    Path(path).write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(path, {k: round(v, 3) for k, v in report["draft"].items() if k in ("pass_rate", "leak_rate", "ungrounded_per_draft")})
