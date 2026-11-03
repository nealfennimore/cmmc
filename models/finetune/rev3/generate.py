#!/usr/bin/env python3
"""
Generate supervised fine-tuning (SFT) data for a small model from the
NIST SP 800-171 Rev. 2 / CMMC Assessment Guide Level 2 JSON in
github.com/nealfennimore/cmmc (client/public/data/sp_800_171_2_0_0).

Every answer is assembled from the source text — nothing is model-generated —
so the dataset is only as accurate as the source JSON.

Usage:
    python3 generate.py <path/to/sp_800_171_2_0_0> <out_dir> [--seed 7]

Outputs (chat "messages" JSONL, works with TRL / Unsloth / Axolotl):
    train.jsonl     training examples (seen question phrasings)
    valid.jsonl     ~5% random hold-out, same phrasings as train
    test.jsonl      held-out phrasings never used in train/valid
    mcq_eval.jsonl  multiple-choice recall eval with gold letters
    corpus.jsonl    one plain-text document per requirement (continued pretraining / RAG)
    stats.json      counts per task and split
"""
import argparse
import collections
import json
import random
import re
from pathlib import Path

SYSTEM = (
    "You are a CMMC Level 2 assistant. Answer questions about the NIST SP 800-171 "
    "Rev. 2 security requirements and the CMMC Assessment Guide – Level 2 accurately "
    "and concisely. If a requirement or identifier does not exist, say so."
)

# FAR 52.204-21 mapping missing from IA.L2-3.5.2 in the source JSON (it is b.1.vi
# in the Assessment Guide). Patched here so the Level 1 mapping list is complete.
FAR_PATCH = {"IA.L2-3.5.2": "FAR Clause 52.204-21 b.1.vi"}

ID_RE = re.compile(r"\b[A-Z]{2}\.L[12]-3\.\d+\.\d+\b")
REF_RE = re.compile(r"\s*\[([a-z]{1,2}(?:\s*,\s*[a-z]{1,2})*)\]")
EXAMPLE_RE = re.compile(r"(?:^|(?<=[.!?:\])\"”\n]))\s*Example(?: \d+)?\s+(?=[A-Z])")


# --------------------------------------------------------------------------- cleaning
def clean(s: str) -> str:
    s = s or ""
    s = s.replace("verses [sic]", "versus").replace(" [sic]", "")
    # PDF page-break artefacts: paragraph breaks in the middle of a sentence
    s = re.sub(r"(?<=[A-Za-z0-9,’\)])[ \t]*\n\n[ \t]*(?=[a-z(])", " ", s)
    # remaining lowercase paragraphs (after "...:" or "...;") are PDF list items -> bullets
    s = re.sub(r"[ \t]*\n\n[ \t]*(?=[a-z])", "\n- ", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def letters(ref_str: str):
    return [x.strip() for x in ref_str.split(",") if x.strip()]


def strip_refs(s: str) -> str:
    return re.sub(r"\s+([.,;?!])", r"\1", REF_RE.sub("", s)).strip()


def fmt_refs(ls):
    return ", ".join(f"[{l}]" for l in ls)


# --------------------------------------------------------------------------- loading
def load(data_dir: Path):
    ag = json.loads((data_dir / "assessment-guide-requirements.json").read_text())
    fw = json.loads((data_dir / "framework.json").read_text())["response"]["elements"]
    shared = json.loads((data_dir / "examine-shared-items.json").read_text())

    fam_names = {e["element_identifier"]: e["title"] for e in fw["elements"] if e["element_type"] == "family"}
    rtype = {}
    for rel in fw["relationships"]:
        d = rel["dest_element_identifier"]
        if d in ("RT_basic", "RT_derived"):
            rtype[rel["source_element_identifier"]] = "basic" if d == "RT_basic" else "derived"

    reqs, acronyms = [], {}
    for r in ag["requirements"]:
        rid = r["id"]
        fam_code = rid.split(".")[0]
        fam_num = r["export_id"][:5]
        fd = r["further_discussion"]
        pre, _, cons = fd.partition("Potential Assessment Considerations")
        parts = EXAMPLE_RE.split(pre)
        guidance = clean(parts[0])
        examples = []
        for ex in parts[1:]:
            ex = clean(ex)
            if not ex:
                continue
            refs = sorted({l for m in REF_RE.finditer(ex) for l in letters(m.group(1))})
            examples.append({"text": ex, "plain": strip_refs(ex), "refs": refs})

        considerations = []
        buf = ""
        for line in clean(cons).split("\n"):
            line = line.strip()
            if not line:
                continue
            buf = f"{buf} {line}".strip()
            if buf.endswith("?") or buf.endswith("]") or buf.endswith("."):
                m = list(REF_RE.finditer(buf))
                refs = sorted({l for mm in m for l in letters(mm.group(1))})
                considerations.append({"q": strip_refs(buf), "refs": refs})
                buf = ""
        if buf:
            considerations.append({"q": strip_refs(buf), "refs": []})

        krefs = r["key_references"]
        # SI.L2-3.14.7's key_references accidentally contains Appendix A (acronym list)
        if "Appendix A – Acronyms and Abbreviations" in krefs:
            i = krefs.index("Appendix A – Acronyms and Abbreviations")
            acr_raw, krefs = krefs[i:], krefs[:i]
            acronyms = parse_acronyms(acr_raw)
        far = next((k for k in krefs if k.startswith("FAR")), None) or FAR_PATCH.get(rid)

        text_all = r["discussion"] + " " + r["further_discussion"]
        related = sorted(set(ID_RE.findall(text_all)) - {rid})

        reqs.append({
            "id": rid,
            "nist": r["nist_sp_800_171"],
            "export_id": r["export_id"],
            "name": r["name"].strip()[:1].upper() + r["name"].strip()[1:],
            "family": fam_code,
            "family_name": fam_names[fam_num],
            "family_num": "3." + str(int(fam_num.split(".")[1])),
            "type": rtype[r["nist_sp_800_171"]],
            "statement": clean(r["statement"]),
            "objectives": {k: clean(v) for k, v in r["assessment_objectives"].items()},
            "methods": {k: [clean(x) for x in v] for k, v in r["assessment_methods"].items()},
            "discussion": clean(r["discussion"]),
            "guidance": guidance,
            "examples": examples,
            "considerations": considerations,
            "far": far,
            "related_raw": related,
        })

    by_export = {r["export_id"]: r for r in reqs}
    ids = {r["id"] for r in reqs}
    for r in reqs:
        r["related"] = [x for x in r["related_raw"] if x in ids]

    artifacts = []
    for name, v in shared.items():
        ctl = [by_export[c] for c in v["controls"] if c in by_export]
        if ctl:
            artifacts.append({"name": clean(name), "reqs": ctl})
    return reqs, artifacts, acronyms


def parse_acronyms(raw):
    items = [x for x in raw if x != "Appendix A – Acronyms and Abbreviations" and not re.match(r"^\d+ ", x)]
    def is_acr(t):
        return " " not in t and len(t) <= 10 and sum(c.isupper() for c in t) >= 2

    out, i = {}, 0
    while i < len(items):
        tok = items[i]
        first, _, rest = tok.partition(" ")
        if rest and is_acr(first) and first.isupper() and (i + 1 >= len(items) or is_acr(items[i + 1])):
            # merged "ACR Expansion" token, e.g. "UUENCODE Unix-to-Unix Encode"
            out[first] = rest
            i += 1
            continue
        if is_acr(tok) and i + 1 < len(items) and not is_acr(items[i + 1]):
            out[tok] = items[i + 1]
            i += 2
            continue
        i += 1  # skip anything that doesn't pair cleanly
    return out


# --------------------------------------------------------------------------- formatting
def head(r):
    return f"**{r['id']} – {r['name']}** (NIST SP 800-171 Rev. 2, {r['nist']})"


def obj_list(r, only=None):
    return "\n".join(f"- [{k}] Determine if {v}." for k, v in r["objectives"].items() if only is None or k in only)


def req_line(r):
    return f"- {r['id']} – {r['name']}"


def type_phrase(r):
    return "a basic" if r["type"] == "basic" else "a derived"


# --------------------------------------------------------------------------- example builder
class Builder:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.items = []  # (split_hint, example)

    def add(self, task, templates, answer, n_train=2, rid=None, **fmt):
        """templates[-1] is reserved for the test split (held-out phrasing)."""
        seen, held = templates[:-1], templates[-1]
        picks = self.rng.sample(seen, min(n_train, len(seen))) if seen else []
        for t in picks:
            self.items.append(("trainval", self._ex(task, t.format(**fmt), answer, rid)))
        if len(templates) >= 2:
            self.items.append(("test", self._ex(task, held.format(**fmt), answer, rid)))

    def add_one(self, task, prompt, answer, rid=None, split="trainval"):
        self.items.append((split, self._ex(task, prompt, answer, rid)))

    def add_convo(self, task, turns, rid=None, split="trainval"):
        msgs = [{"role": "system", "content": SYSTEM}]
        for u, a in turns:
            msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
        self.items.append((split, {"messages": msgs, "meta": {"task": task, "id": rid}}))

    @staticmethod
    def _ex(task, prompt, answer, rid):
        return {
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": answer},
            ],
            "meta": {"task": task, "id": rid},
        }


def build(reqs, artifacts, acronyms, seed):
    B = Builder(seed)
    rng = B.rng
    by_id = {r["id"]: r for r in reqs}
    fams = collections.OrderedDict()
    for r in reqs:
        fams.setdefault(r["family"], []).append(r)
    name_counts = collections.Counter(r["name"].lower() for r in reqs)

    for r in reqs:
        f = dict(id=r["id"], nist=r["nist"], name=r["name"], fam=r["family_name"])
        n_obj = len(r["objectives"])

        # 1. requirement statement
        B.add("statement", [
            "What does {id} require?",
            "What is CMMC requirement {id}?",
            "Give me the requirement statement for {id}.",
            "What does NIST SP 800-171 requirement {nist} say?",
            "{id}",
            "Summarize CMMC Level 2 practice {id}.",
            "Can you tell me what {id} is about?",
        ], f"{head(r)}\n\n{r['statement']}\n\nFamily: {r['family_name']} ({r['family']}). "
           f"It is {type_phrase(r)} security requirement.", n_train=3, rid=r["id"], **f)

        # 2. statement -> id
        B.add("statement_to_id", [
            'Which CMMC Level 2 requirement says: "{statement}"',
            'What is the requirement ID for this control: "{statement}"',
            'Identify the NIST SP 800-171 requirement: "{statement}"',
            'Which control is this? "{statement}"',
        ], f"That is {head(r)}, in the {r['family_name']} family.", n_train=2, rid=r["id"],
            statement=r["statement"], **f)

        # 3. name -> id (only if name is unique)
        if name_counts[r["name"].lower()] == 1:
            B.add("name_to_id", [
                'What is the CMMC identifier for "{name}"?',
                'Which requirement is called "{name}"?',
                'What is the NIST SP 800-171 number for the requirement "{name}"?',
                'Look up the "{name}" requirement.',
            ], f"\"{r['name']}\" is {r['id']} (NIST SP 800-171 Rev. 2, {r['nist']}): {r['statement']}",
                n_train=2, rid=r["id"], **f)

        # 4. NIST <-> CMMC id mapping
        B.add("nist_to_cmmc", [
            "What is the CMMC Level 2 ID for NIST SP 800-171 {nist}?",
            "Map NIST {nist} to its CMMC practice identifier.",
            "NIST SP 800-171 Rev. 2 {nist} corresponds to which CMMC requirement?",
        ], f"NIST SP 800-171 Rev. 2 {r['nist']} is {r['id']} – {r['name']}.", n_train=1, rid=r["id"], **f)
        B.add("cmmc_to_nist", [
            "Which NIST SP 800-171 requirement number is {id}?",
            "What NIST control number does {id} map to?",
            "{id} is which NIST SP 800-171 Rev. 2 requirement?",
        ], f"{r['id']} ({r['name']}) is NIST SP 800-171 Rev. 2 requirement {r['nist']}.", n_train=1, rid=r["id"], **f)

        # 5. family
        B.add("family_of", [
            "Which family does {id} belong to?",
            "What domain is {id} in?",
            "Which NIST SP 800-171 family contains requirement {nist}?",
            "What control family is {id} part of?",
        ], f"{r['id']} ({r['name']}) is in the {r['family_name']} ({r['family']}) family, "
           f"section {r['family_num']} of NIST SP 800-171 Rev. 2.", n_train=1, rid=r["id"], **f)

        # 6. basic vs derived
        B.add("req_type", [
            "Is {id} a basic or derived security requirement?",
            "Is NIST SP 800-171 {nist} basic or derived?",
            "What type of security requirement is {id}?",
            "Classify {id} as basic or derived.",
        ], f"{r['id']} ({r['name']}) is {type_phrase(r)} security requirement in NIST SP 800-171 Rev. 2.",
            n_train=1, rid=r["id"], **f)

        # 7. all objectives
        B.add("objectives", [
            "What are the assessment objectives for {id}?",
            "List the determination statements for {id}.",
            "What must an assessor determine to evaluate {id}?",
            "Give me the assessment objectives for NIST SP 800-171 {nist}.",
            "Break {id} down into its assessment objectives.",
        ], f"{head(r)} has {n_obj} assessment objective{'s' if n_obj != 1 else ''}:\n\n{obj_list(r)}",
            n_train=3, rid=r["id"], **f)

        # 8. objective count
        B.add("objective_count", [
            "How many assessment objectives does {id} have?",
            "How many determination statements are in {id}?",
            "Number of objectives in {id}?",
        ], f"{r['id']} has {n_obj} assessment objective{'s' if n_obj != 1 else ''} "
           f"({', '.join('[' + k + ']' for k in r['objectives'])}).", n_train=1, rid=r["id"], **f)

        # 9. single objective + reverse lookup
        for k, v in r["objectives"].items():
            B.add("objective_single", [
                "What is assessment objective {id}[{k}]?",
                "What does {id}[{k}] say?",
                "In {id}, what is objective [{k}]?",
                "What is determination statement {nist}[{k}]?",
                "Explain objective [{k}] of {id}.",
            ], f"{r['id']}[{k}] ({r['name']}): Determine if {v}.", n_train=2, rid=r["id"], k=k, **f)

        # 10. MET rule
        B.add("met_rule", [
            "What does it take for {id} to be scored MET?",
            "When is {id} considered MET in a CMMC assessment?",
            "What must be true for an assessor to mark {id} as MET?",
        ], f"{r['id']} is MET only when every one of its {n_obj} assessment objective"
           f"{'s is' if n_obj != 1 else ' is'} met (or not applicable). If any objective is NOT MET, "
           f"the requirement is NOT MET.\n\n{obj_list(r)}", n_train=1, rid=r["id"], **f)

        # 11. assessment methods
        m = r["methods"]
        if m.get("examine"):
            B.add("examine", [
                "What should an assessor examine for {id}?",
                "What documents or artifacts are examined when assessing {id}?",
                "What evidence should I have ready for {id}?",
                "List the examine objects for {id}.",
            ], f"Examine objects for {r['id']} ({r['name']}):\n\n" + "\n".join(f"- {x}" for x in m["examine"]),
                n_train=2, rid=r["id"], **f)
        if m.get("interview"):
            B.add("interview", [
                "Who should be interviewed when assessing {id}?",
                "Which personnel does an assessor interview for {id}?",
                "Interview targets for {id}?",
            ], f"Interview objects for {r['id']} ({r['name']}):\n\n" + "\n".join(f"- {x}" for x in m["interview"]),
                n_train=1, rid=r["id"], **f)
        if m.get("test"):
            B.add("test", [
                "What can an assessor test for {id}?",
                "What mechanisms or processes are tested for {id}?",
                "What are the test objects for {id}?",
            ], f"Test objects for {r['id']} ({r['name']}):\n\n" + "\n".join(f"- {x}" for x in m["test"]),
                n_train=1, rid=r["id"], **f)
        sections = []
        for key, label in (("examine", "Examine"), ("interview", "Interview"), ("test", "Test")):
            if m.get(key):
                sections.append(f"**{label}**\n" + "\n".join(f"- {x}" for x in m[key]))
        B.add("methods_all", [
            "What are the assessment methods and objects for {id}?",
            "How is {id} assessed?",
            "Give me the examine, interview, and test objects for {id}.",
        ], f"Assessment methods for {head(r)}:\n\n" + "\n\n".join(sections), n_train=1, rid=r["id"], **f)

        # 12. NIST discussion
        B.add("discussion", [
            "Explain {id}.",
            "What is the purpose of {id}?",
            "What does the NIST discussion say about requirement {nist}?",
            "Why does {id} matter?",
            "Give me the background on {id}.",
        ], f"{head(r)}\n\n{r['discussion']}", n_train=2, rid=r["id"], **f)

        # 13. CMMC further discussion (guidance)
        if r["guidance"]:
            B.add("guidance", [
                "What does the CMMC Assessment Guide's further discussion say about {id}?",
                "Give practical guidance for meeting {id}.",
                "How should a company approach implementing {id}?",
                "In plain language, what does {id} expect an organization to do?",
            ], f"{head(r)}\n\n{r['guidance']}", n_train=2, rid=r["id"], **f)

        # 14. implementation examples & scenario -> requirement
        for i, ex in enumerate(r["examples"]):
            refs = ex["refs"]
            tail = ""
            if refs:
                tail = "\n\nThis illustrates objective" + ("s " if len(refs) > 1 else " ") + fmt_refs(refs) + ":\n" + obj_list(r, refs)
            B.add("example", [
                "Give an example of how a company might meet {id}.",
                "What does compliance with {id} look like in practice?",
                "Describe a scenario that satisfies {id}.",
                "Show me a real-world example for {name} ({id}).",
            ], f"Example for {r['id']} ({r['name']}):\n\n{ex['plain']}{tail}",
                n_train=1 if i else 2, rid=r["id"], **f)
            if r["id"] not in ex["plain"] and refs:
                B.add("scenario_to_req", [
                    "Which CMMC Level 2 requirement does this scenario best illustrate?\n\n{plain}",
                    "Read this scenario and identify the CMMC requirement and assessment objectives it demonstrates:\n\n{plain}",
                    "{plain}\n\nWhich NIST SP 800-171 requirement is this an example of?",
                ], f"This scenario illustrates {head(r)}, specifically objective"
                   + ("s " if len(refs) > 1 else " ") + fmt_refs(refs) + ":\n\n" + obj_list(r, refs),
                    n_train=1, rid=r["id"], plain=ex["plain"], **f)

        # 15. potential assessment considerations
        if r["considerations"]:
            lines = [f"- {c['q']}" + (f" ({fmt_refs(c['refs'])})" if c["refs"] else "") for c in r["considerations"]]
            B.add("considerations", [
                "What questions might an assessor ask when evaluating {id}?",
                "What are the potential assessment considerations for {id}?",
                "How do I prepare for an assessor's questions on {id}?",
                "What will a C3PAO assessor look for under {id}?",
            ], f"Potential assessment considerations for {r['id']} ({r['name']}):\n\n" + "\n".join(lines),
                n_train=2, rid=r["id"], **f)
            for c in r["considerations"]:
                if c["refs"] and all(l in r["objectives"] for l in c["refs"]):
                    B.add("consideration_to_objective", [
                        'For {id}, which assessment objectives does this question address: "{q}"',
                        'Which objectives of {id} does the assessment consideration "{q}" map to?',
                        '"{q}" — which {id} objectives is this checking?',
                    ], f"It addresses {r['id']} objective" + ("s " if len(c["refs"]) > 1 else " ")
                       + fmt_refs(c["refs"]) + ":\n\n" + obj_list(r, c["refs"]), n_train=1, rid=r["id"], q=c["q"], **f)

        # 16. FAR 52.204-21 / Level 1 mapping
        if r["far"]:
            clause = r["far"].replace("FAR Clause ", "")
            partial = "Partial" in clause
            clause = clause.replace("Partial ", "")
            ans = (f"Yes. {r['id']} ({r['name']}) {'partially ' if partial else ''}maps to FAR clause {clause}, "
                   f"one of the basic safeguarding requirements CMMC Level 1 is built on.")
        else:
            ans = (f"No. The Assessment Guide lists no FAR 52.204-21 mapping for {r['id']} ({r['name']}); "
                   f"its key reference is NIST SP 800-171 Rev. 2 {r['nist']} only.")
        B.add("far_mapping", [
            "Does {id} map to FAR 52.204-21?",
            "Is {id} also part of the FAR basic safeguarding requirements?",
            "Is {id} one of the requirements that also appears at CMMC Level 1?",
            "What are the key references for {id}?",
        ], ans, n_train=2, rid=r["id"], **f)

        # 17. related requirements referenced in the text
        if r["related"]:
            B.add("related", [
                "Which other requirements does the guidance for {id} reference?",
                "What requirements are related to {id}?",
                "Does {id} depend on or overlap with other CMMC requirements?",
            ], f"The discussion for {r['id']} ({r['name']}) references:\n\n"
               + "\n".join(f"- {x} – {by_id[x]['name']}" for x in r["related"]), n_train=1, rid=r["id"], **f)

        # 18. two-turn conversation
        B.add_convo("convo", [
            (rng.choice([f"What is {r['id']}?", f"Tell me about {r['id']}.", f"What does {r['nist']} require?"]),
             f"{head(r)}\n\n{r['statement']}"),
            (rng.choice(["What are its assessment objectives?", "How is it assessed?", "What objectives does it have?"]),
             f"{r['id']} has {n_obj} assessment objective{'s' if n_obj != 1 else ''}:\n\n{obj_list(r)}"),
        ], rid=r["id"])

    # objective reverse lookup (unique determination statements only)
    oc = collections.Counter(v.lower() for r in reqs for v in r["objectives"].values())
    for r in reqs:
        for k, v in r["objectives"].items():
            if oc[v.lower()] == 1:
                B.add("objective_to_id", [
                    'Which requirement and objective contains the determination statement: "{v}"?',
                    'Where does "{v}" come from in the CMMC Assessment Guide?',
                    'Identify the objective: "Determine if {v}."',
                ], f"That is {r['id']}[{k}] – {r['name']} (NIST SP 800-171 Rev. 2, {r['nist']}[{k}]).",
                    n_train=1, rid=r["id"], v=v)

    # family-level questions
    for code, rs in fams.items():
        fn = rs[0]["family_name"]
        f = dict(fam=fn, code=code, num=rs[0]["family_num"])
        lst = "\n".join(req_line(r) for r in rs)
        B.add("family_list", [
            "List the requirements in the {fam} family.",
            "What are the {code} requirements in CMMC Level 2?",
            "Which practices are in section {num} of NIST SP 800-171 Rev. 2?",
            "Show all {fam} ({code}) requirements.",
            "What controls make up the {code} domain?",
        ], f"The {fn} ({code}) family, NIST SP 800-171 Rev. 2 section {rs[0]['family_num']}, has {len(rs)} requirements:\n\n{lst}",
            n_train=4, rid=None, **f)
        B.add("family_count", [
            "How many requirements are in the {fam} family?",
            "How many {code} practices does CMMC Level 2 have?",
            "Count of requirements in the {code} domain?",
        ], f"The {fn} ({code}) family has {len(rs)} requirements "
           f"({sum(r['type'] == 'basic' for r in rs)} basic and {sum(r['type'] == 'derived' for r in rs)} derived).",
            n_train=2, rid=None, **f)
        for t in ("basic", "derived"):
            sub = [r for r in rs if r["type"] == t]
            ans = (f"The {t} security requirements in {fn} ({code}) are:\n\n" + "\n".join(req_line(r) for r in sub)) if sub \
                else f"{fn} ({code}) has no {t} security requirements."
            B.add(f"family_{t}", [
                "Which {fam} requirements are " + t + "?",
                "List the " + t + " security requirements in the {code} family.",
                "What are the " + t + " requirements in section {num}?",
            ], ans, n_train=2, rid=None, **f)
        B.add("family_code", [
            "What family does the abbreviation {code} stand for?",
            "What is the {code} domain in CMMC?",
            "{code} family?",
        ], f"{code} is {fn}, section {rs[0]['family_num']} of NIST SP 800-171 Rev. 2 ({len(rs)} requirements).",
            n_train=2, rid=None, **f)

    # global questions
    fam_lines = "\n".join(f"- {c} – {rs[0]['family_name']} ({rs[0]['family_num']}, {len(rs)} requirements)" for c, rs in fams.items())
    n_b = sum(r["type"] == "basic" for r in reqs)
    n_d = len(reqs) - n_b
    n_o = sum(len(r["objectives"]) for r in reqs)
    for t, a in [
        (["What are the 14 families in NIST SP 800-171 Rev. 2?", "List the CMMC Level 2 domains.",
          "Which control families does CMMC Level 2 cover?", "Name all NIST SP 800-171 families with their codes.",
          "What domains are in CMMC Level 2?"],
         f"NIST SP 800-171 Rev. 2 (CMMC Level 2) has {len(fams)} families and {len(reqs)} requirements:\n\n{fam_lines}"),
        (["How many requirements are in CMMC Level 2?", "How many security requirements does NIST SP 800-171 Rev. 2 have?",
          "How many practices does CMMC Level 2 include?", "Total number of CMMC Level 2 requirements?"],
         f"CMMC Level 2 has {len(reqs)} security requirements from NIST SP 800-171 Rev. 2 ({n_b} basic, {n_d} derived), "
         f"with {n_o} assessment objectives in total, across {len(fams)} families."),
        (["How many assessment objectives are in CMMC Level 2 in total?", "Total number of determination statements in the Level 2 assessment guide?",
          "How many objectives does NIST SP 800-171A define for the 110 requirements?"],
         f"There are {n_o} assessment objectives across the {len(reqs)} CMMC Level 2 requirements."),
        (["What is the difference between basic and derived security requirements?", "Basic vs derived requirements in NIST SP 800-171?",
          "Explain basic and derived security requirements.", "Why are some NIST SP 800-171 requirements called derived?"],
         "In NIST SP 800-171 Rev. 2, basic security requirements come from FIPS 200 (the high-level minimum security "
         "requirements), and derived security requirements supplement them and come from the security controls in "
         f"NIST SP 800-53. Of the {len(reqs)} requirements, {n_b} are basic and {n_d} are derived."),
        (["Which CMMC Level 2 requirements map to FAR 52.204-21?", "List the Level 2 requirements that correspond to the FAR basic safeguarding clause.",
          "Which of the 110 requirements are also Level 1 requirements?", "What requirements overlap between CMMC Level 1 and Level 2?"],
         "These Level 2 requirements map to FAR 52.204-21 b.1 (the basis of CMMC Level 1):\n\n"
         + "\n".join(f"- {r['id']} – {r['name']} ({r['far'].replace('FAR Clause ', '')})" for r in reqs if r["far"])),
    ]:
        B.add("global", t, a, n_train=len(t) - 1)

    # artifacts -> requirements
    for art in artifacts:
        rs = art["reqs"]
        listing = (f"all {len(reqs)} CMMC Level 2 requirements." if len(rs) == len(reqs) else
                   f"{len(rs)} requirement{'s' if len(rs) != 1 else ''}:\n\n" + "\n".join(req_line(r) for r in rs))
        B.add("artifact_to_reqs", [
            'Which requirements list "{a}" as an examine object?',
            'What CMMC requirements can "{a}" serve as evidence for?',
            'Where is "{a}" used in a CMMC Level 2 assessment?',
            'If I produce "{a}", which requirements does that help with?',
        ], f"\"{art['name']}\" is an examine object for {listing}", n_train=1, a=art["name"])

    # acronyms (Appendix A)
    for acr, exp in acronyms.items():
        B.add("acronym", [
            "What does {acr} stand for?",
            "Expand the acronym {acr}.",
            "In the CMMC Assessment Guide, what is {acr}?",
        ], f"{acr} stands for {exp}.", n_train=1, acr=acr)

    # negatives: identifiers that do not exist
    fam_max = {c: max(int(r["nist"].split(".")[2]) for r in rs) for c, rs in fams.items()}
    fam_num = {c: rs[0]["family_num"] for c, rs in fams.items()}
    num_fam = {v: c for c, v in fam_num.items()}
    for c in fams:
        for extra in (1, 2, 4):
            n = fam_max[c] + extra
            fake = f"{c}.L2-{fam_num[c]}.{n}"
            B.add("nonexistent", [
                "What does {fake} require?",
                "What are the assessment objectives for {fake}?",
                "Explain {fake}.",
            ], f"{fake} does not exist. The {fams[c][0]['family_name']} ({c}) family in NIST SP 800-171 Rev. 2 "
               f"has {len(fams[c])} requirements, {fams[c][0]['id']} through {fams[c][-1]['id']}.",
                n_train=1, fake=fake)
    for bad in ("3.15.1", "3.16.2", "3.17.1", "3.0.1"):
        B.add("nonexistent", [
            "What does NIST SP 800-171 Rev. 2 requirement {b} say?",
            "What is CMMC requirement {b}?",
            "Explain requirement {b}.",
        ], f"NIST SP 800-171 Rev. 2 has no requirement {bad}. Its {len(fams)} families are numbered 3.1 through 3.14."
           + (" Families 3.15–3.17 (Planning, System and Services Acquisition, Supply Chain Risk Management) exist only "
              "in NIST SP 800-171 Rev. 3, numbered 03.15–03.17." if bad.startswith(("3.15", "3.16", "3.17")) else ""),
            n_train=1, b=bad)
    # wrong family prefix on a real number
    for r in rng.sample(reqs, 30):
        wrong = rng.choice([c for c in fams if c != r["family"]])
        fake = f"{wrong}.L2-{r['nist']}"
        B.add("wrong_prefix", [
            "What does {fake} require?",
            "Tell me about {fake}.",
            "What are the objectives for {fake}?",
        ], f"{fake} is not a valid identifier: requirement {r['nist']} is in the {r['family_name']} ({r['family']}) family, "
           f"so the correct ID is {r['id']} – {r['name']}.\n\n{r['statement']}", n_train=1, rid=r["id"], fake=fake)

    # MCQ-format training items (family membership, basic/derived) so the model learns
    # the letter-answer format without seeing any mcq_eval item.
    letters_ = "ABCD"
    fam_list = list(fams)
    for r in reqs:
        opts = [r["family_name"]] + rng.sample([fams[c][0]["family_name"] for c in fam_list if c != r["family"]], 3)
        rng.shuffle(opts)
        q = f"Which family does the requirement \"{r['name']}\" belong to?\n\n" + "\n".join(
            f"{letters_[i]}. {o}" for i, o in enumerate(opts)) + "\n\nAnswer with the letter only."
        B.add_one("mcq_train_family", q, letters_[opts.index(r["family_name"])], rid=r["id"])
        opts = ["Basic", "Derived"]
        q = f"Is {r['id']} ({r['name']}) a basic or derived security requirement?\n\nA. Basic\nB. Derived\n\nAnswer with the letter only."
        B.add_one("mcq_train_type", q, "A" if r["type"] == "basic" else "B", rid=r["id"])

    return B.items


def build_mcq(reqs, seed):
    rng = random.Random(seed + 1)
    fams = collections.defaultdict(list)
    for r in reqs:
        fams[r["family"]].append(r)
    out, L = [], "ABCD"

    def distractors(r, k=3):
        pool = [x for x in fams[r["family"]] if x["id"] != r["id"]]
        if len(pool) < k:
            pool += rng.sample([x for x in reqs if x["family"] != r["family"]], k - len(pool))
        return rng.sample(pool, k)

    def emit(task, stem, correct, wrong, rid):
        opts = [correct] + wrong
        rng.shuffle(opts)
        q = stem + "\n\n" + "\n".join(f"{L[i]}. {o}" for i, o in enumerate(opts)) + "\n\nAnswer with the letter only."
        out.append({
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q},
                         {"role": "assistant", "content": L[opts.index(correct)]}],
            "answer": L[opts.index(correct)],
            "meta": {"task": task, "id": rid},
        })

    for r in reqs:
        d = distractors(r)
        emit("mcq_statement_to_id", f"Which requirement states: \"{r['statement']}\"",
             r["id"], [x["id"] for x in d], r["id"])
        d = distractors(r)
        emit("mcq_id_to_name", f"What is the name of {r['id']}?", r["name"], [x["name"] for x in d], r["id"])
        for ex in r["examples"][:1]:
            if r["id"] not in ex["plain"]:
                d = distractors(r)
                emit("mcq_scenario", f"Which requirement does this scenario best illustrate?\n\n{ex['plain']}",
                     f"{r['id']} – {r['name']}", [f"{x['id']} – {x['name']}" for x in d], r["id"])
        n = len(r["objectives"])
        wrong = rng.sample([x for x in range(1, max(n + 5, 8)) if x != n], 3)
        emit("mcq_objective_count", f"How many assessment objectives does {r['id']} have?",
             str(n), [str(x) for x in wrong], r["id"])
    return out


def corpus(reqs):
    docs = []
    for r in reqs:
        parts = [f"{r['id']} – {r['name']}",
                 f"NIST SP 800-171 Rev. 2 {r['nist']}. Family: {r['family_name']} ({r['family']}). "
                 f"Type: {r['type']} security requirement." + (f" Maps to {r['far']}." if r["far"] else ""),
                 f"Requirement: {r['statement']}",
                 "Assessment objectives:\n" + obj_list(r)]
        for key, label in (("examine", "Examine"), ("interview", "Interview"), ("test", "Test")):
            if r["methods"].get(key):
                parts.append(f"{label}:\n" + "\n".join(f"- {x}" for x in r["methods"][key]))
        parts.append(f"Discussion:\n{r['discussion']}")
        if r["guidance"]:
            parts.append(f"Further discussion:\n{r['guidance']}")
        for i, ex in enumerate(r["examples"], 1):
            parts.append(f"Example {i}:\n{ex['text']}")
        if r["considerations"]:
            parts.append("Potential assessment considerations:\n" + "\n".join(
                f"- {c['q']}" + (f" {fmt_refs(c['refs'])}" if c["refs"] else "") for c in r["considerations"]))
        docs.append({"id": r["id"], "text": "\n\n".join(parts)})
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--valid-frac", type=float, default=0.05)
    ap.add_argument("--test-per-task", type=int, default=25)
    a = ap.parse_args()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    reqs, artifacts, acronyms = load(Path(a.data_dir))
    items = build(reqs, artifacts, acronyms, a.seed)

    # dedupe on (user prompts, answer)
    seen, uniq = set(), []
    for split, ex in items:
        key = tuple(m["content"] for m in ex["messages"][1:])
        if key in seen:
            continue
        seen.add(key)
        uniq.append((split, ex))

    rng = random.Random(a.seed + 2)
    trainval = [ex for s, ex in uniq if s == "trainval"]
    test = [ex for s, ex in uniq if s == "test"]
    rng.shuffle(trainval)
    rng.shuffle(test)
    # cap the held-out-phrasing test set per task so it stays quick to evaluate
    per_task = collections.defaultdict(int)
    capped = []
    for ex in test:
        t = ex["meta"]["task"]
        if per_task[t] < a.test_per_task:
            per_task[t] += 1
            capped.append(ex)
    test = capped
    n_val = max(1, int(len(trainval) * a.valid_frac))
    splits = {"train": trainval[n_val:], "valid": trainval[:n_val], "test": test,
              "mcq_eval": build_mcq(reqs, a.seed)}
    for name, rows in splits.items():
        with open(out / f"{name}.jsonl", "w") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(out / "corpus.jsonl", "w") as fh:
        for d in corpus(reqs):
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")

    stats = {name: {"examples": len(rows),
                    "by_task": dict(sorted(collections.Counter(r["meta"]["task"] for r in rows).items()))}
             for name, rows in splits.items()}
    stats["source"] = {"requirements": len(reqs), "objectives": sum(len(r["objectives"]) for r in reqs),
                       "examples": sum(len(r["examples"]) for r in reqs), "artifacts": len(artifacts),
                       "acronyms": len(acronyms)}
    (out / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps({k: v["examples"] if isinstance(v, dict) and "examples" in v else v for k, v in stats.items()}, indent=2))


if __name__ == "__main__":
    main()
