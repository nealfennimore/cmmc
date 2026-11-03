#!/usr/bin/env python3
"""
Score a model directory (base or merged) on three suites and write JSON:

  mcq    mcq_eval.jsonl, exact letter match per task (memorization).
  recall test.jsonl (held-out phrasings): ID recall and token F1 against the
         reference answer (generalization to new wording).
  draft  the app's real task: the exact app prompt (app_prompt.py, the
         focused sub-statement branch) on the fixture evidence and on the
         held-out split of data/draft. checks.py flags leaks, invented
         details, pronouns, and formatting. This is the regression gate: a
         fine-tune that wins on mcq but loses here must not ship.

    python evaluate.py --model llama-3.2-1b-instruct --which base
    python evaluate.py --model llama-3.2-1b-instruct --which tuned
"""
import argparse
import collections
import json
import random
import re
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

import app_prompt
import checks
from presets import PRESETS

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True, choices=sorted(PRESETS))
ap.add_argument("--which", required=True, choices=["base", "tuned"])
ap.add_argument("--data", default=str(HERE.parent / "rev3" / "out_combined"))
ap.add_argument("--runs", default=str(HERE / "runs"))
ap.add_argument("--suites", default="mcq,recall,draft")
ap.add_argument("--recall-n", type=int, default=400)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--draft-data", default=str(HERE / "data" / "draft"))
ap.add_argument("--draft-n", type=int, default=150, help="held-out draft rows to score")
args = ap.parse_args()

p = PRESETS[args.model]
run = Path(args.runs) / args.model
src = p["base"] if args.which == "base" else str(run / "merged")

tok = AutoTokenizer.from_pretrained(src, padding_side="left")
if tok.pad_token is None:
    tok.pad_token = tok.eos_token  # inference only: pad never reaches the labels
model = AutoModelForCausalLM.from_pretrained(src, dtype=torch.bfloat16, device_map="cuda").eval()


def generate(conversations, max_new_tokens, **kw):
    outs = []
    for i in range(0, len(conversations), args.batch):
        texts = [tok.apply_chat_template(c, tokenize=False, add_generation_prompt=True)
                 for c in conversations[i:i + args.batch]]
        enc = tok(texts, return_tensors="pt", padding=True, add_special_tokens=False).to("cuda")
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False,
                                 pad_token_id=tok.pad_token_id, **kw)
        outs += tok.batch_decode(gen[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
    return outs


def jsonl(name):
    return [json.loads(line) for line in open(Path(args.data) / name)]


ID_RE = re.compile(r"\b(?:[A-Z]{2}\.L[12]-)?3\.\d{1,2}\.\d{1,2}(?:\[[a-z]\])?|\b(?:A\.)?03\.\d{2}\.\d{2}[\w.\[\]]*")


def tokens(s):
    return re.findall(r"\w+", s.lower())


def f1(pred, ref):
    pc, rc = collections.Counter(tokens(pred)), collections.Counter(tokens(ref))
    common = sum((pc & rc).values())
    if not common:
        return 0.0
    prec, rec = common / sum(pc.values()), common / sum(rc.values())
    return 2 * prec * rec / (prec + rec)


def suite_mcq():
    rows = jsonl("mcq_eval.jsonl")
    preds = generate([r["messages"][:-1] for r in rows], 4)
    hits, totals = collections.Counter(), collections.Counter()
    for r, text in zip(rows, preds):
        m = re.search(r"[ABCD]", text)
        totals[r["meta"]["task"]] += 1
        hits[r["meta"]["task"]] += int(bool(m) and m.group(0) == r["answer"])
    per_task = {t: hits[t] / totals[t] for t in sorted(totals)}
    return {"overall": sum(hits.values()) / sum(totals.values()), "per_task": per_task}


def suite_recall():
    rows = jsonl("test.jsonl")
    random.Random(7).shuffle(rows)
    rows = [r for r in rows if r["messages"][-1]["role"] == "assistant"][: args.recall_n]
    preds = generate([r["messages"][:-1] for r in rows], 384)
    by_task = collections.defaultdict(lambda: {"f1": [], "id_recall": []})
    samples = []
    for r, pred in zip(rows, preds):
        ref = r["messages"][-1]["content"]
        ids = set(ID_RE.findall(ref))
        t = by_task[r["meta"]["task"]]
        t["f1"].append(f1(pred, ref))
        if ids:
            t["id_recall"].append(sum(i in pred for i in ids) / len(ids))
        samples.append({"task": r["meta"]["task"], "q": r["messages"][-2]["content"], "ref": ref, "pred": pred})
    mean = lambda xs: sum(xs) / len(xs) if xs else None
    per_task = {k: {"f1": mean(v["f1"]), "id_recall": mean(v["id_recall"]), "n": len(v["f1"])}
                for k, v in sorted(by_task.items())}
    all_f1 = [x for v in by_task.values() for x in v["f1"]]
    all_id = [x for v in by_task.values() for x in v["id_recall"]]
    return {"f1": mean(all_f1), "id_recall": mean(all_id), "per_task": per_task, "samples": samples[:60]}


def draft_cases():
    """Every sub-statement of the fixture requirements (fixed evidence), plus
    the held-out split of the generated draft data when it exists."""
    by_req = collections.defaultdict(list)
    for c in app_prompt.focus_cases(2):
        by_req[c["requirementId"]].append(c)
    cases = [{"case": c, "chunks": fx["chunks"], "source": "fixture"}
             for fx in json.loads((HERE / "fixtures" / "draft_cases.json").read_text())
             for c in by_req[fx["requirementId"]]]
    test = Path(args.draft_data) / "test.jsonl"
    if test.exists():
        lookup = {(c["rev"], c["focusId"]): c for r in (2, 3) for c in app_prompt.focus_cases(r)}
        rows = [json.loads(line) for line in open(test)]
        random.Random(7).shuffle(rows)
        for r in rows[: args.draft_n]:
            m = r["meta"]
            cases.append({"case": lookup[(m["rev"], m["focusId"])], "chunks": r["chunks"], "source": "heldout",
                          "reference": r["messages"][-1]["content"]})
    return cases


def suite_draft():
    cases = draft_cases()
    # Same settings as the app: DRAFT_MAX_NEW_TOKENS = 300, repetition_penalty 1.1 (worker.ts).
    preds = generate([app_prompt.build_messages(c["case"], c["chunks"]) for c in cases], 300,
                     repetition_penalty=1.1)
    results = []
    for c, pred in zip(cases, preds):
        r = checks.check(pred, c["chunks"])
        results.append({"focusId": c["case"]["focusId"], "source": c["source"], "output": pred,
                        "pass": checks.passes(r), **r, **({"reference": c["reference"]} if "reference" in c else {})})

    def summary(rs):
        n = len(rs) or 1
        return {"n": len(rs),
                "pass_rate": sum(r["pass"] for r in rs) / n,
                "leak_rate": sum(bool(r["id_leaks"] or r["term_leaks"]) for r in rs) / n,
                "ungrounded_per_draft": sum(len(r["ungrounded"]) for r in rs) / n}

    return summary(results) | {
        "by_source": {s: summary([r for r in results if r["source"] == s]) for s in ("fixture", "heldout")},
        "cases": results,
    }


report = {"model": args.model, "which": args.which, "source": src}
for s in args.suites.split(","):
    report[s] = {"mcq": suite_mcq, "recall": suite_recall, "draft": suite_draft}[s]()
    print(s, json.dumps({k: v for k, v in report[s].items() if k not in ("samples", "cases", "per_task")}))

dst = run / "eval" / f"{args.which}.json"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(f"wrote {dst}")
