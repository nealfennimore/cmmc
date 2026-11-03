#!/usr/bin/env python3
"""
Build draft-task training data: for each sub-statement that the app can
draft, a teacher model (Claude, or any OpenAI-compatible endpoint) writes made-up
evidence excerpts for a fictional organization and then a grounded
narrative for the app's exact prompt. checks.py rejects teacher narratives
that leak requirement language, invent details, or break the format.

    # Claude (Anthropic SDK; reads ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY)
    uv run --group teacher python gen_drafts.py --backend claude --limit 10 --variants 1

    # Any OpenAI-compatible endpoint, for example a local llama-server
    export TEACHER_API_KEY=...            # omit for an endpoint without auth
    python3 gen_drafts.py --base-url https://fwdesktop.54rockybrook.house/v1 \\
        --model qwen3.8-27b --variants 2 --workers 4 --no-think

The openai backend needs the standard library only. Writes data/draft/raw.jsonl
(resumable: rerun to continue) and then train/valid/test.jsonl, split by
requirement. Never trains on fixtures/draft_cases.json: those requirements
always go to test.
"""
import argparse
import hashlib
import json
import os
import random
import re
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_prompt  # noqa: E402
import checks  # noqa: E402

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--backend", choices=["openai", "claude", "claude-code"], default="openai",
                help="openai: any OpenAI-compatible endpoint. claude: Anthropic SDK (teacher_claude.py). "
                     "claude-code: the claude CLI, headless (teacher_claude_code.py)")
ap.add_argument("--base-url", help="OpenAI-compatible base URL, ending in /v1 (openai backend)")
ap.add_argument("--model", help="default for --backend claude: claude-opus-5-5")
ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"],
                help="claude backend: thinking effort")
ap.add_argument("--no-fallback", action="store_true", help="claude backend: no server-side refusal fallback")
ap.add_argument("--out", type=Path, default=HERE / "data" / "draft")
ap.add_argument("--variants", type=int, default=2, help="evidence sets per sub-statement")
ap.add_argument("--workers", type=int, default=4)
ap.add_argument("--revs", default="2,3")
ap.add_argument("--limit", type=int, help="only the first N sub-statements (smoke test)")
ap.add_argument("--retries", type=int, default=2, help="narrative rewrites after a failed check")
ap.add_argument("--no-think", action="store_true", help="disable reasoning (Qwen3 chat_template_kwargs)")
args = ap.parse_args()
if args.backend == "claude":
    from teacher_claude import ClaudeTeacher
    args.model = args.model or "claude-opus-5-5"
    TEACHER = ClaudeTeacher(args.model, args.effort, fallback=not args.no_fallback)
elif args.backend == "claude-code":
    from teacher_claude_code import ClaudeCodeTeacher
    args.model = args.model or "claude-opus-5-5"
    TEACHER = ClaudeCodeTeacher(args.model, args.effort)
elif not (args.base_url and args.model):
    ap.error("--backend openai needs --base-url and --model")

KEY = os.environ.get("TEACHER_API_KEY", "")
FIXTURE_REQS = {(2, c["requirementId"]) for c in json.loads((HERE / "fixtures" / "draft_cases.json").read_text())}

# Fictional names only. A quarter of the organizations stay unnamed, so the
# model also learns the "The organization" fallback.
ORGS = ["Bramblecote Precision", "Kestrel Ridge Avionics", "Halvorsen Composites", "Tidewater Systems Group",
        "Ostrander Machine Works", "Pellucid Analytics", "Graywacke Engineering", "Marlowe Hydraulics",
        "Quillfeather Software", "Ironbark Defense Solutions", "Saltmarsh Optics", "Corvane Logistics",
        "Fennwick Microelectronics", "Blue Heron Fabrication", "Ashgrove Research", "Tamarind Aerospace"]
INDUSTRY = ["CNC machining shop", "avionics subcontractor", "composite materials manufacturer",
            "software development contractor", "logistics provider", "optics manufacturer",
            "engineering services firm", "electronics assembler", "research lab", "shipyard supplier"]
SIZE = ["12 employees", "35 employees", "80 employees", "150 employees", "400 employees"]
STACK = {
    "identity": ["on-prem Active Directory", "Microsoft Entra ID", "Okta", "JumpCloud"],
    "productivity": ["Microsoft 365 GCC High", "Microsoft 365 GCC", "Google Workspace", "PreVeil"],
    "endpoint": ["Microsoft Intune", "Jamf Pro", "ManageEngine Endpoint Central", "NinjaOne"],
    "edr": ["CrowdStrike Falcon", "Microsoft Defender for Endpoint", "SentinelOne", "Sophos Intercept X"],
    "logging": ["Splunk Cloud", "Microsoft Sentinel", "Wazuh", "Graylog", "Blumira"],
    "network": ["Palo Alto PA-440 firewalls", "Fortinet FortiGate 60F", "Cisco Meraki MX", "pfSense"],
    "ticketing": ["ServiceNow", "Jira Service Management", "Freshservice", "Zendesk"],
    "backup": ["Veeam Backup & Replication", "Datto SIRIS", "Acronis Cyber Protect", "Rubrik"],
}
MODES = {
    "full": "Together the excerpts clearly show how the organization meets the statement, with concrete specifics.",
    "partial": "The excerpts show only part of what the statement asks. Leave at least one aspect unaddressed.",
    "noisy": "One or two excerpts address the statement. Add one or two excerpts from the same organization that "
             "cover an unrelated security topic, as a keyword search would return.",
}

EVIDENCE_SYSTEM = ("You write realistic excerpts from the internal documents of a fictional organization: policies, "
                   "procedures, configuration exports, tickets, spreadsheets, and logs. Return JSON only.")


def evidence_prompt(case, rng):
    named = rng.random() >= 0.25
    org = rng.choice(ORGS) if named else None
    stack = "; ".join(f"{k}: {rng.choice(v)}" for k, v in STACK.items())
    mode = rng.choices(list(MODES), weights=[5, 3, 2])[0]
    who = (f"The organization is {org}, a {rng.choice(INDUSTRY)} with {rng.choice(SIZE)}. The documents use the "
           f"name {org}." if named else
           f"The organization is a {rng.choice(INDUSTRY)} with {rng.choice(SIZE)}. The documents never state its "
           f"name: they say \"the company\", \"we\", or nothing.")
    user = f"""{who}
Technology in use (use only what fits): {stack}.

Security statement to produce evidence for:
{case['subText']}
(Context: {case['title']}. {case['statement']})

{MODES[mode]}

Write 2 to 4 excerpts. Each excerpt is 40 to 160 words from one document, with a realistic filename
(.pdf, .docx, .xlsx, .csv, .txt, or .png for a screenshot transcript). Use concrete specifics: product names,
settings and values, frequencies, counts, role titles, ticket numbers, dates. Vary the document types.
Do not quote the statement wording. Do not mention requirement numbers.

Return: {{"excerpts": [{{"filename": "...", "text": "..."}}]}}"""
    return mode, org, [{"role": "system", "content": EVIDENCE_SYSTEM}, {"role": "user", "content": user}]


TEACHER_NOTE = ("Teacher note, not part of the app prompt: follow the system instructions exactly. Copy names and "
                "numbers exactly as the excerpts write them. Ignore excerpts that do not relate to the statement. "
                "If the excerpts never name the organization, write \"The organization\". Output only the narrative.")


def chat(messages, temperature, max_tokens, json_mode=False):
    if args.backend == "claude":
        # Thinking counts toward max_tokens on Claude, so leave headroom. No temperature.
        return TEACHER.chat(messages, 16000, json_mode)
    if args.backend == "claude-code":
        return TEACHER.chat(messages, json_mode)
    body = {"model": args.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if args.no_think:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(args.base_url.rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {KEY}"} if KEY else {})})
    with urllib.request.urlopen(req, timeout=600) as resp:
        text = json.loads(resp.read())["choices"][0]["message"]["content"] or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def parse_excerpts(text):
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    data = json.loads(text[text.find("{"): text.rfind("}") + 1])
    ex = [{"filename": str(e["filename"]).strip(), "text": str(e["text"]).strip()} for e in data["excerpts"]]
    if not 2 <= len(ex) <= 4 or any(not e["filename"] or len(e["text"].split()) < 20 for e in ex):
        raise ValueError(f"bad excerpts: {len(ex)}")
    return ex


def work(case, variant):
    key = f"{case['rev']}:{case['focusId']}:{variant}"
    rng = random.Random(key)
    mode, org, ev_msgs = evidence_prompt(case, rng)
    chunks = parse_excerpts(chat(ev_msgs, 0.9, 1400, json_mode=True))
    app_msgs = app_prompt.build_messages(case, chunks)
    # One system message: some chat templates (Qwen3) reject a second one.
    teacher = [{"role": "system", "content": app_msgs[0]["content"] + "\n\n" + TEACHER_NOTE}, app_msgs[1]]
    attempts = []
    for _ in range(args.retries + 1):
        draft = chat(teacher, 0.3, 400)
        result = checks.check(draft, chunks)
        attempts.append({"draft": draft, "check": result})
        if checks.passes(result):
            break
        problems = {k: v for k, v in result.items() if v and k not in ("words",)}
        teacher = teacher + [{"role": "assistant", "content": draft},
                             {"role": "user", "content": "Rewrite it. Problems found: " + json.dumps(problems)
                              + ". Use only details that appear in the excerpts, at most 120 words, plain prose."}]
    return {"key": key, "rev": case["rev"], "requirementId": case["requirementId"], "focusId": case["focusId"],
            "mode": mode, "org": org, "chunks": chunks, "messages": app_msgs, "attempts": attempts,
            "ok": checks.passes(attempts[-1]["check"])}


def split_of(rev, req):
    if (rev, req) in FIXTURE_REQS:
        return "test"
    h = int(hashlib.sha256(f"{rev}:{req}".encode()).hexdigest(), 16) % 100
    return "test" if h < 10 else "valid" if h < 15 else "train"


def main():
    args.out.mkdir(parents=True, exist_ok=True)
    raw = args.out / "raw.jsonl"
    done = {json.loads(l)["key"] for l in open(raw)} if raw.exists() else set()
    cases = [c for r in args.revs.split(",") for c in app_prompt.focus_cases(int(r))][: args.limit]
    todo = [(c, v) for c in cases for v in range(args.variants) if f"{c['rev']}:{c['focusId']}:{v}" not in done]
    print(f"{len(cases)} sub-statements x {args.variants} variants: {len(done)} done, {len(todo)} to do")
    lock, stats = threading.Lock(), {"ok": 0, "rejected": 0, "error": 0}
    with ThreadPoolExecutor(args.workers) as pool, open(raw, "a") as fh:
        futures = {pool.submit(work, c, v): (c, v) for c, v in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                row = fut.result()
            except Exception as e:  # network, JSON, or teacher format errors: skip, rerun retries them
                stats["error"] += 1
                print(f"error {futures[fut][0]['focusId']}: {e}", file=sys.stderr)
                continue
            with lock:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                fh.flush()
                stats["ok" if row["ok"] else "rejected"] += 1
            if i % 20 == 0:
                print(f"{i}/{len(todo)} {stats}")
    print(stats)
    if args.backend == "claude-code":
        print(f"usage this run: {TEACHER.usage}")
    if args.backend == "claude":
        u = TEACHER.usage
        prices = {"claude-opus-5-5": (4, 20), "claude-sonnet-5-5": (2, 10), "claude-haiku-5-5": (0.10, 0.50)}
        cost = ""
        if args.model in prices:
            pin, pout = prices[args.model]
            cost = f", about ${(u['input_tokens'] * pin + u['output_tokens'] * pout) / 1e6:.2f} at list price"
        print(f"usage this run: {u}{cost}")

    splits = {"train": [], "valid": [], "test": []}
    for line in open(raw):
        row = json.loads(line)
        if not row["ok"]:
            continue
        out = {"messages": row["messages"] + [{"role": "assistant", "content": row["attempts"][-1]["draft"]}],
               "chunks": row["chunks"],
               "meta": {k: row[k] for k in ("rev", "requirementId", "focusId", "mode", "org")} | {"task": "draft"}}
        splits[split_of(row["rev"], row["requirementId"])].append(out)
    for name, rows in splits.items():
        random.Random(7).shuffle(rows)
        with open(args.out / f"{name}.jsonl", "w") as fh:
            fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        print(name, len(rows))


if __name__ == "__main__":
    main()
