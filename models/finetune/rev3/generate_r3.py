#!/usr/bin/env python3
"""
Generate SFT data for NIST SP 800-171 Rev. 3 (+ SP 800-171A Rev. 3 assessment procedures and the
DoD organization-defined parameter values) from github.com/nealfennimore/cmmc
client/public/data/sp_800_171_3_0_0. The sibling sp_800_171_2_0_0 folder is also read so
Rev 2 <-> Rev 3 transition questions can be answered.

Every answer is assembled from the source JSON — nothing is model-generated.

Usage:
    python3 generate_r3.py <path/to/client/public/data> <out_dir> [--seed 7]

Same output layout as generate.py: train / valid / test / mcq_eval / corpus / stats.
SPRS values in values.json are intentionally NOT used: for Rev 3 they are this project's
estimates (no official Rev 3 scoring methodology exists), not source facts.
"""
import argparse
import collections
import json
import random
import re
from pathlib import Path

SYSTEM = (
    "You are a NIST SP 800-171 assistant. Answer questions about NIST SP 800-171 Rev. 3, its "
    "SP 800-171A Rev. 3 assessment procedures, and the DoD organization-defined parameter (ODP) "
    "values accurately and concisely. If a requirement or identifier does not exist, say so."
)
REV = "NIST SP 800-171 Rev. 3"
ODP_SRC = "DoD CIO memo of April 10, 2025 (DoD ODPs for NIST SP 800-171 Rev. 3)"
NCO = "NCO (not directly related to protecting the confidentiality of CUI)"


def natkey(s):
    out = []
    for p in re.split(r"[.\[\]]", s):
        if not p:
            continue
        out.append((0, int(p), "") if p.isdigit() else (1, 0, p))
    return out


def split_select(t):
    t = t.strip()
    m = re.match(r"^\[SELECT FROM:\s*(.*)\]$", t, re.S)
    body = m.group(1) if m else t
    return [x.strip().rstrip(".") for x in body.split(";") if x.strip()]


def top_level_placeholders(text):
    out, depth, start = [], 0, None
    for i, ch in enumerate(text):
        if ch == "[":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "]" and depth:
            depth -= 1
            if depth == 0:
                out.append(text[start:i + 1])
    return out


# --------------------------------------------------------------------------- load
def load(data_root: Path):
    d3 = data_root / "sp_800_171_3_0_0"
    fw = json.loads((d3 / "framework.json").read_text())["response"]["elements"]
    odp_doc = json.loads((d3 / "odp.json").read_text())
    E = {e["element_identifier"]: e for e in fw["elements"]}
    proj = collections.defaultdict(list)
    withdrawn_to = collections.defaultdict(list)   # WR-id -> [(kind, target)]
    sources_53 = collections.defaultdict(list)
    for r in fw["relationships"]:
        s, d, k = r["source_element_identifier"], r["dest_element_identifier"], r["relationship_identifier"]
        if k == "projection":
            proj[s].append(d)
        elif k in ("incorporated_into", "addressed_by"):
            withdrawn_to[s].append((k, d))
        elif k == "external_reference":
            sources_53[s].append(d)

    families = {k: e["title"] for k, e in E.items() if e["element_type"] == "family"}
    by_type = collections.defaultdict(list)
    for k, e in E.items():
        by_type[e["element_type"]].append(k)

    # Rev 2 (for transition questions)
    rev2 = {}
    p2 = data_root / "sp_800_171_2_0_0" / "assessment-guide-requirements.json"
    if p2.exists():
        for r in json.loads(p2.read_text())["requirements"]:
            rev2[r["export_id"]] = {"cmmc": r["id"], "nist": r["nist_sp_800_171"], "name": r["name"].strip()[:1].upper()
                                    + r["name"].strip()[1:], "statement": r["statement"].strip()}

    # DoD ODP values grouped by requirement
    dod = collections.defaultdict(list)
    for rid, xs in odp_doc["controls"].items():
        for x in xs:
            dod[rid].append(x)
    footnotes = odp_doc.get("footnotes", {})

    reqs = []
    for rid in sorted(by_type["requirement"], key=natkey):
        fam = rid[:5]
        wr = E.get("WR-" + rid)
        item = {"id": rid, "family": fam, "family_name": families[fam], "title": E[rid]["title"].strip(),
                "withdrawn": bool(wr), "rev2": rev2.get(rid)}
        if wr:
            item["withdraw_reason"] = wr["text"].strip()
            item["withdrawn_to"] = sorted(withdrawn_to.get("WR-" + rid, []), key=lambda x: natkey(x[1]))
            reqs.append(item)
            continue

        # statement tree
        srs = sorted([k for k in by_type["security_requirement"] if k == "SR-" + rid or k.startswith("SR-" + rid + ".")],
                     key=natkey)
        parts = []
        for k in srs:
            e = E[k]
            if not e["text"]:
                continue
            depth = len(k[len("SR-" + rid):].split(".")) - 1  # 0 = root, 1 = a, 2 = a.01
            label = e["title"]
            if depth >= 2:
                label = str(int(label)) if label.isdigit() else label
            parts.append({"sid": k[3:], "depth": depth, "label": label, "text": e["text"].strip()})
        dets = sorted([k for k in by_type["determination"] if k.startswith("DS-A." + rid)], key=natkey)
        odps = sorted([k for k in by_type["odp"] if k.startswith("A." + rid + ".ODP")], key=natkey)
        item.update({
            "parts": parts,
            "determinations": [{"id": k[3:], "text": E[k]["text"].strip()} for k in dets],
            "odps": [{"id": k, "label": E[k]["title"], "text": E[k]["text"].strip()} for k in odps],
            "discussion": E.get("D-" + rid, {}).get("text", "").strip(),
            "examine": split_select(E["E-" + rid]["text"]) if "E-" + rid in E else [],
            "interview": split_select(E["I-" + rid]["text"]) if "I-" + rid in E else [],
            "test": split_select(E["T-" + rid]["text"]) if "T-" + rid in E else [],
            "references": [{"id": x, "title": E[x]["title"], "url": E[x]["text"]}
                           for x in proj[rid] if E.get(x, {}).get("element_type") == "reference"],
            "sp800_53": sorted(sources_53.get(rid, []), key=natkey),
            "dod_odps": [],
        })
        part_by_sid = {p["sid"]: p for p in parts}
        for x in dod.get(rid, []):
            pid = x["id"]
            ctx = part_by_sid.get(pid) or part_by_sid.get(pid.rsplit(".", 1)[0])
            item["dod_odps"].append({"pid": pid, "assignment": x["assignment"], "value": x["value"].strip(),
                                     "guidance": bool(x.get("guidance")), "context": ctx["text"] if ctx else None,
                                     "footnotes": [footnotes[f] for f in x.get("footnotes", []) if f in footnotes]})
        reqs.append(item)

    by_id = {r["id"]: r for r in reqs}
    # absorbed: active req -> withdrawn reqs pointing to it
    for r in reqs:
        if r["withdrawn"]:
            for kind, t in r["withdrawn_to"]:
                by_id[t].setdefault("absorbed", []).append((kind, r["id"]))
    refs = {k: {"title": E[k]["title"], "url": E[k]["text"]} for k in by_type["reference"]}
    return reqs, families, refs, footnotes


# --------------------------------------------------------------------------- formatting
def statement(r):
    lines = []
    for p in r["parts"]:
        if p["depth"] == 0:
            lines.append(p["text"])
        elif p["depth"] == 1:
            lines.append(f"{p['label']}. {p['text']}")
        else:
            lines.append("   " * (p["depth"] - 1) + f"{p['label']}. {p['text']}")
    return "\n".join(lines)


def head(r):
    return f"**{r['id']} – {r['title']}** ({REV}, {r['family_name']})"


def ref_name(by_id, rid):
    r = by_id.get(rid)
    if not r:
        return rid
    return f"{rid} – {r['title']}" if r["title"] else f"{rid} (withdrawn)"


def det_list(r):
    return "\n".join(f"- {d['id']}: Determine if {d['text']}" for d in r["determinations"])


def odp_list(r):
    return "\n".join(f"- {o['id']}: {o['text'][:1].upper() + o['text'][1:]}" for o in r["odps"])


def withdraw_text(r, by_id):
    reason = r["withdraw_reason"]
    if reason.startswith("Recategorized as NCO"):
        reason = f"Recategorized as {NCO}."
    tgt = r["withdrawn_to"]
    if tgt:
        inc = [t for k, t in tgt if k == "incorporated_into"]
        adr = [t for k, t in tgt if k == "addressed_by"]
        bits = []
        if inc:
            bits.append("incorporated into " + ", ".join(ref_name(by_id, t) for t in inc))
        if adr:
            bits.append("addressed by " + ", ".join(ref_name(by_id, t) for t in adr))
        return "It was " + " and ".join(bits) + "."
    return f"Reason: {reason}"


def rev2_line(r2):
    return f"{r2['nist']} (CMMC {r2['cmmc']} – {r2['name']}): \"{r2['statement']}\""


# --------------------------------------------------------------------------- builder
class Builder:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.items = []

    def _ex(self, task, prompt, answer, rid):
        return {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt},
                             {"role": "assistant", "content": answer}], "meta": {"task": task, "id": rid}}

    def add(self, task, templates, answer, n_train=2, rid=None, **fmt):
        seen, held = templates[:-1], templates[-1]
        for t in self.rng.sample(seen, min(n_train, len(seen))):
            self.items.append(("trainval", self._ex(task, t.format(**fmt), answer, rid)))
        self.items.append(("test", self._ex(task, held.format(**fmt), answer, rid)))

    def add_one(self, task, prompt, answer, rid=None):
        self.items.append(("trainval", self._ex(task, prompt, answer, rid)))

    def add_convo(self, task, turns, rid=None):
        msgs = [{"role": "system", "content": SYSTEM}]
        for u, a in turns:
            msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
        self.items.append(("trainval", {"messages": msgs, "meta": {"task": task, "id": rid}}))


def build(reqs, families, refs, footnotes, seed):
    B = Builder(seed)
    rng = B.rng
    by_id = {r["id"]: r for r in reqs}
    active = [r for r in reqs if not r["withdrawn"]]
    withdrawn = [r for r in reqs if r["withdrawn"]]
    fam_active = collections.OrderedDict((f, [r for r in active if r["family"] == f]) for f in sorted(families))
    fam_all = collections.OrderedDict((f, [r for r in reqs if r["family"] == f]) for f in sorted(families))
    title_counts = collections.Counter(r["title"].lower() for r in active)

    for r in active:
        f = dict(id=r["id"], title=r["title"], fam=r["family_name"])
        st = statement(r)
        nd, no = len(r["determinations"]), len(r["odps"])

        B.add("statement", [
            "What does {id} require in NIST SP 800-171 Rev. 3?",
            "What is Rev 3 requirement {id}?",
            "Give me the requirement text for {id} ({title}).",
            "{id}",
            "Show NIST SP 800-171r3 {id}.",
            "Summarize 800-171 Rev. 3 requirement {id}.",
            "Can you tell me what Rev 3 {id} says?",
        ], f"{head(r)}\n\n{st}", n_train=3, rid=r["id"], **f)

        if title_counts[r["title"].lower()] == 1:
            B.add("title_to_id", [
                'Which NIST SP 800-171 Rev. 3 requirement is "{title}"?',
                'What is the Rev 3 identifier for "{title}"?',
                'Look up the Rev 3 requirement "{title}".',
                'What number is "{title}" in 800-171 Rev. 3?',
            ], f"\"{r['title']}\" is {r['id']} in {REV} ({r['family_name']} family).\n\n{st}",
                n_train=2, rid=r["id"], **f)
        B.add("id_to_title", [
            "What is the title of Rev 3 requirement {id}?",
            "What is {id} called in NIST SP 800-171 Rev. 3?",
            "Name of 800-171r3 {id}?",
        ], f"{r['id']} is \"{r['title']}\" ({REV}, {r['family_name']} family).", n_train=1, rid=r["id"], **f)

        B.add("family_of", [
            "Which family does Rev 3 requirement {id} belong to?",
            "What family is {id} ({title}) in under NIST SP 800-171 Rev. 3?",
            "In 800-171 Rev. 3, which control family contains {title}?",
        ], f"{r['id']} ({r['title']}) is in the {r['family_name']} family ({r['family']}) of {REV}.",
            n_train=1, rid=r["id"], **f)

        # first-part reverse lookup (most distinctive line of the statement)
        first = r["parts"][0]["text"] if r["parts"][0]["depth"] == 0 else next(
            (p["text"] for p in r["parts"] if p["depth"] == 1), None)
        if first and len(first) > 40 and "[Assignment" not in first[:20]:
            B.add("text_to_id", [
                'Which NIST SP 800-171 Rev. 3 requirement says: "{first}"',
                'Identify the Rev 3 requirement containing: "{first}"',
                'Where in 800-171 Rev. 3 does this appear? "{first}"',
            ], f"That is from {head(r)}.", n_train=1, rid=r["id"], first=first, **f)

        # determination statements (SP 800-171A Rev. 3)
        B.add("determinations", [
            "What are the assessment objectives (determination statements) for Rev 3 {id}?",
            "List the SP 800-171A Rev. 3 determination statements for {id}.",
            "What does an assessor need to determine for 800-171r3 {id}?",
            "How is Rev 3 {id} ({title}) assessed? Give the determination statements.",
            "Break Rev 3 {id} down into its determination statements.",
        ], f"{head(r)} has {nd} determination statement{'s' if nd != 1 else ''} in SP 800-171A Rev. 3:\n\n{det_list(r)}",
            n_train=3, rid=r["id"], **f)
        B.add("determination_count", [
            "How many determination statements does Rev 3 {id} have?",
            "How many SP 800-171A Rev. 3 assessment objectives are in {id}?",
            "Number of determination statements for 800-171r3 {id}?",
        ], f"{r['id']} ({r['title']}) has {nd} determination statement{'s' if nd != 1 else ''}"
           + (f" plus {no} ODP determination{'s' if no != 1 else ''}." if no else "."), n_train=1, rid=r["id"], **f)
        for d in r["determinations"]:
            B.add("determination_single", [
                "What is SP 800-171A Rev. 3 determination statement {did}?",
                "What does {did} say?",
                "Explain Rev 3 assessment objective {did}.",
            ], f"{d['id']} ({r['title']}): Determine if {d['text']}", n_train=1, rid=r["id"], did=d["id"])

        # ODPs
        if r["odps"]:
            B.add("odps", [
                "What organization-defined parameters (ODPs) does Rev 3 {id} have?",
                "List the ODPs for NIST SP 800-171 Rev. 3 {id}.",
                "Which parameters must an organization define for 800-171r3 {id} ({title})?",
                "What ODP assessment objectives apply to Rev 3 {id}?",
            ], f"{r['id']} ({r['title']}) has {no} organization-defined parameter{'s' if no != 1 else ''}:\n\n{odp_list(r)}",
                n_train=2, rid=r["id"], **f)
            for o in r["odps"]:
                B.add("odp_single", [
                    "What is {oid}?",
                    "What does ODP {oid} define?",
                    "Explain Rev 3 parameter {oid}.",
                ], f"{o['id']} ({r['title']}, {o['label']}): {o['text'][:1].upper() + o['text'][1:]}",
                    n_train=1, rid=r["id"], oid=o["id"])
        else:
            B.add("odps", [
                "Does Rev 3 {id} have any organization-defined parameters?",
                "What ODPs does {id} have in NIST SP 800-171 Rev. 3?",
                "Are there ODPs in 800-171r3 {id}?",
            ], f"No. {r['id']} ({r['title']}) has no organization-defined parameters in {REV}.",
                n_train=1, rid=r["id"], **f)

        # DoD ODP values
        if r["dod_odps"]:
            lines = []
            for x in r["dod_odps"]:
                tag = " (guidance)" if x["guidance"] else ""
                lines.append(f"- {x['pid']} – {x['assignment']}{tag}: {x['value']}")
            B.add("dod_odps_all", [
                "What DoD ODP values apply to Rev 3 {id}?",
                "What values has DoD set for the organization-defined parameters in {id} ({title})?",
                "Under DoD's 800-171 Rev. 3 ODPs, how is {id} tailored?",
                "Give me the DoD-defined parameters for NIST SP 800-171r3 {id}.",
            ], f"DoD ODP values for {r['id']} ({r['title']}), per the {ODP_SRC}:\n\n" + "\n".join(lines),
                n_train=2, rid=r["id"], **f)
            for x in r["dod_odps"]:
                ctx = f" — \"{x['context']}\"" if x["context"] else ""
                if x["guidance"]:
                    body = f"DoD defines this ODP as guidance rather than a fixed value:\n\n{x['value']}"
                else:
                    body = f"DoD value: {x['value']}"
                notes = "".join(f"\n\nNote — {fn}" for fn in x["footnotes"])
                B.add("dod_odp_single", [
                    "What is the DoD-defined value for the {asg} in Rev 3 {pid}?",
                    "Under the DoD ODPs, what is the {asg} for {title} ({pid})?",
                    "What does DoD require for the {asg} in 800-171r3 {pid}?",
                    "DoD ODP for {pid} ({asg})?",
                ], f"{x['pid']} ({r['title']}){ctx}\n\nParameter: {x['assignment']}\n{body}\n\nSource: {ODP_SRC}.{notes}",
                    n_train=2, rid=r["id"], asg=x["assignment"], pid=x["pid"], title=r["title"])

        # assessment methods
        for key, label, tmpls in (
            ("examine", "Examine", ["What should an assessor examine for Rev 3 {id}?",
                                    "What documents and artifacts are examined for 800-171r3 {id}?",
                                    "What evidence should I have for Rev 3 {id} ({title})?",
                                    "List the SP 800-171A Rev. 3 examine objects for {id}."]),
            ("interview", "Interview", ["Who is interviewed when assessing Rev 3 {id}?",
                                        "Which personnel does SP 800-171A Rev. 3 list as interview objects for {id}?",
                                        "Interview objects for 800-171r3 {id}?"]),
            ("test", "Test", ["What is tested for Rev 3 {id}?",
                              "Which mechanisms or processes are test objects for 800-171r3 {id}?",
                              "Test objects for Rev 3 {id}?"]),
        ):
            if r[key]:
                B.add(key, tmpls, f"{label} objects for {r['id']} ({r['title']}), SP 800-171A Rev. 3 (select from):\n\n"
                      + "\n".join(f"- {x}" for x in r[key]), n_train=2 if key == "examine" else 1, rid=r["id"], **f)
        secs = [f"**{lbl}**\n" + "\n".join(f"- {x}" for x in r[k])
                for k, lbl in (("examine", "Examine"), ("interview", "Interview"), ("test", "Test")) if r[k]]
        if secs:
            B.add("methods_all", [
                "What are the SP 800-171A Rev. 3 assessment methods and objects for {id}?",
                "Give me the examine, interview, and test objects for Rev 3 {id}.",
                "How would an assessor evaluate 800-171r3 {id} ({title})?",
            ], f"Assessment methods for {head(r)} (select from):\n\n" + "\n\n".join(secs), n_train=1, rid=r["id"], **f)

        # discussion
        if r["discussion"]:
            B.add("discussion", [
                "Explain Rev 3 requirement {id}.",
                "What does the NIST discussion say about 800-171 Rev. 3 {id}?",
                "What is the purpose of {id} ({title}) in Rev 3?",
                "Why does Rev 3 {id} matter?",
                "Give me background on NIST SP 800-171r3 {id}.",
            ], f"{head(r)}\n\n{r['discussion']}", n_train=2, rid=r["id"], **f)

        # SP 800-53 source controls
        if r["sp800_53"]:
            B.add("sp800_53", [
                "Which SP 800-53 Rev. 5 controls is Rev 3 {id} based on?",
                "What are the source controls for NIST SP 800-171 Rev. 3 {id}?",
                "Map 800-171r3 {id} ({title}) to SP 800-53.",
                "What SP 800-53 controls does Rev 3 {id} come from?",
            ], f"{r['id']} ({r['title']}) is sourced from these SP 800-53 Rev. 5 controls: " + ", ".join(r["sp800_53"]) + ".",
                n_train=2, rid=r["id"], **f)

        # references
        if r["references"]:
            B.add("references", [
                "What references does NIST list for Rev 3 {id}?",
                "Which NIST publications are referenced by 800-171r3 {id}?",
                "Further reading for Rev 3 {id} ({title})?",
            ], f"References for {r['id']} ({r['title']}):\n\n" + "\n".join(
                f"- {x['id']}: {x['title']}" for x in r["references"]), n_train=1, rid=r["id"], **f)

        # Rev 2 transition
        if r["rev2"]:
            r2 = r["rev2"]
            extra = ""
            if r.get("absorbed"):
                extra = "\n\nIt also absorbs these withdrawn Rev 2 requirements: " + ", ".join(
                    f"{t} ({'incorporated' if k == 'incorporated_into' else 'addressed'})" for k, t in r["absorbed"]) + "."
            B.add("rev2_counterpart", [
                "What was Rev 3 {id} in Rev 2?",
                "Which Rev 2 requirement does 800-171r3 {id} correspond to?",
                "How does Rev 3 {id} ({title}) relate to NIST SP 800-171 Rev. 2?",
                "Is Rev 3 {id} carried over from Rev 2?",
            ], f"{r['id']} ({r['title']}) keeps the Rev 2 number: it is the Rev 3 version of Rev 2 {rev2_line(r2)}"
               f"\n\nRev 3 text:\n{st}{extra}", n_train=2, rid=r["id"], **f)
            B.add("rev2_to_rev3", [
                "What is Rev 2 requirement {nist} in NIST SP 800-171 Rev. 3?",
                "Where did CMMC {cmmc} go in 800-171 Rev. 3?",
                "Map Rev 2 {nist} ({name}) to Rev 3.",
                "What does Rev 2 {nist} become in Rev 3?",
            ], f"Rev 2 {r2['nist']} ({r2['cmmc']} – {r2['name']}) continues in Rev 3 as {r['id']} – {r['title']}.",
                n_train=2, rid=r["id"], nist=r2["nist"], cmmc=r2["cmmc"], name=r2["name"])
        else:
            extra = ""
            if r.get("absorbed"):
                extra = " It absorbs withdrawn Rev 2 requirement" + ("s " if len(r["absorbed"]) > 1 else " ") + ", ".join(
                    f"{t}" + (f" (Rev 2 {by_id[t]['rev2']['nist']})" if by_id[t]["rev2"] else "") for _, t in r["absorbed"]) + "."
            B.add("new_in_rev3", [
                "Is Rev 3 {id} new, or did it exist in Rev 2?",
                "Did {id} ({title}) exist in NIST SP 800-171 Rev. 2?",
                "What was 800-171r3 {id} in Rev 2?",
            ], f"{r['id']} ({r['title']}) is new in Rev 3 — no Rev 2 requirement had this number.{extra}",
                n_train=2, rid=r["id"], **f)

        if r.get("absorbed"):
            B.add("absorbed", [
                "Which withdrawn requirements were folded into Rev 3 {id}?",
                "What other requirements does 800-171r3 {id} ({title}) now cover?",
                "Which withdrawn Rev 3 requirements point to {id}?",
            ], f"These withdrawn requirements point to {r['id']} ({r['title']}):\n\n" + "\n".join(
                f"- {t} ({'incorporated into' if k == 'incorporated_into' else 'addressed by'} {r['id']})"
                + (f" — was Rev 2 {by_id[t]['rev2']['nist']}: {by_id[t]['rev2']['statement']}" if by_id[t]["rev2"] else "")
                for k, t in r["absorbed"]), n_train=1, rid=r["id"], **f)

        B.add_convo("convo", [
            (rng.choice([f"What is Rev 3 {r['id']}?", f"Tell me about 800-171r3 {r['id']}.", f"What does {r['title']} require in Rev 3?"]),
             f"{head(r)}\n\n{st}"),
            (rng.choice(["What are its determination statements?", "How is it assessed?", "What does the assessor need to determine?"]),
             f"{r['id']} has {nd} determination statement{'s' if nd != 1 else ''}:\n\n{det_list(r)}"),
        ], rid=r["id"])

    # withdrawn requirements
    for r in withdrawn:
        f = dict(id=r["id"])
        why = withdraw_text(r, by_id)
        r2 = r["rev2"]
        r2txt = f"\n\nIn Rev 2 this was {rev2_line(r2)}" if r2 else ""
        B.add("withdrawn", [
            "What does Rev 3 requirement {id} require?",
            "What happened to {id} in NIST SP 800-171 Rev. 3?",
            "Is 800-171r3 {id} still a requirement?",
            "Explain Rev 3 {id}.",
        ], f"{r['id']} is withdrawn in {REV}. {why}{r2txt}", n_train=2, rid=r["id"], **f)
        if r2:
            B.add("rev2_to_rev3", [
                "What is Rev 2 requirement {nist} in NIST SP 800-171 Rev. 3?",
                "Where did CMMC {cmmc} go in 800-171 Rev. 3?",
                "Map Rev 2 {nist} ({name}) to Rev 3.",
                "What does Rev 2 {nist} become in Rev 3?",
            ], f"Rev 2 {r2['nist']} ({r2['cmmc']} – {r2['name']}) is withdrawn in Rev 3 as {r['id']}. {why}",
                n_train=2, rid=r["id"], nist=r2["nist"], cmmc=r2["cmmc"], name=r2["name"])

    # determination reverse lookup (unique, no ODP placeholders)
    dc = collections.Counter(d["text"].lower() for r in active for d in r["determinations"])
    for r in active:
        for d in r["determinations"]:
            if dc[d["text"].lower()] == 1 and "<A." not in d["text"]:
                B.add("determination_to_id", [
                    'Which Rev 3 determination statement is: "{t}"',
                    'Where does "Determine if {t}" come from in SP 800-171A Rev. 3?',
                    'Identify the 800-171A r3 objective: "{t}"',
                ], f"That is {d['id']} – {r['title']} ({REV}).", n_train=1, rid=r["id"], t=d["text"])

    # families
    for code, rs in fam_active.items():
        fn = families[code]
        wd = [r for r in fam_all[code] if r["withdrawn"]]
        f = dict(fam=fn, code=code)
        B.add("family_list", [
            "List the requirements in the {fam} family of NIST SP 800-171 Rev. 3.",
            "What are the Rev 3 {fam} requirements?",
            "Which requirements are in family {code} of 800-171r3?",
            "Show all active {fam} requirements in Rev 3.",
            "What controls make up {fam} ({code}) in Rev 3?",
        ], f"The {fn} family ({code}) has {len(rs)} active requirement{'s' if len(rs) != 1 else ''} in {REV}:\n\n"
           + "\n".join(f"- {r['id']} – {r['title']}" for r in rs)
           + (f"\n\nWithdrawn in Rev 3: {', '.join(r['id'] for r in wd)}." if wd else ""), n_train=4, **f)
        B.add("family_count", [
            "How many requirements are in the Rev 3 {fam} family?",
            "How many active {fam} requirements does NIST SP 800-171 Rev. 3 have?",
            "Count of requirements in 800-171r3 family {code}?",
        ], f"{fn} ({code}) has {len(rs)} active requirement{'s' if len(rs) != 1 else ''} in {REV}"
           + (f" and {len(wd)} withdrawn." if wd else "."), n_train=2, **f)
        B.add("family_code", [
            "What is family {code} in NIST SP 800-171 Rev. 3?",
            "Which Rev 3 family is numbered {code}?",
            "800-171r3 family {code}?",
        ], f"{code} is {fn} in {REV}.", n_train=2, **f)
        if wd:
            B.add("family_withdrawn", [
                "Which {fam} requirements were withdrawn in Rev 3?",
                "What was removed from the {fam} family in NIST SP 800-171 Rev. 3?",
                "Withdrawn Rev 3 requirements in family {code}?",
            ], f"Withdrawn {fn} requirements in {REV}:\n\n" + "\n".join(
                f"- {r['id']}: {withdraw_text(r, by_id)}" for r in wd), n_train=2, **f)

    # global facts
    n_det = sum(len(r["determinations"]) for r in active)
    n_odp = sum(len(r["odps"]) for r in active)
    new = [r for r in active if not r["rev2"]]
    new_fams = [c for c in families if all(not r["rev2"] for r in fam_active[c])]
    fam_lines = "\n".join(f"- {c} – {families[c]} ({len(fam_active[c])} requirements)" for c in fam_active)
    n_dod = sum(len(r["dod_odps"]) for r in active)
    for t, a in [
        (["What are the families in NIST SP 800-171 Rev. 3?", "List the 800-171 Rev. 3 control families.",
          "How many families does Rev 3 have and what are they?", "Name every family in 800-171r3.",
          "What families make up NIST SP 800-171 Rev. 3?"],
         f"{REV} has {len(families)} families and {len(active)} active requirements:\n\n{fam_lines}"),
        (["How many requirements are in NIST SP 800-171 Rev. 3?", "How many security requirements does 800-171r3 have?",
          "Total number of Rev 3 requirements?", "How many requirements does Revision 3 of SP 800-171 contain?"],
         f"{REV} has {len(active)} active security requirements across {len(families)} families "
         f"({len(withdrawn)} requirement numbers are withdrawn). SP 800-171A Rev. 3 assesses them with {n_det} determination "
         f"statements plus {n_odp} ODP determinations."),
        (["What families are new in Rev 3?", "Which control families did NIST SP 800-171 Rev. 3 add?",
          "What new families were added in 800-171r3 compared to Rev 2?", "New families in Revision 3?"],
         "Rev 3 adds three families that Rev 2 did not have:\n\n" + "\n".join(
             f"- {c} – {families[c]}: " + ", ".join(f"{r['id']} {r['title']}" for r in fam_active[c]) for c in new_fams)),
        (["Which requirements are new in NIST SP 800-171 Rev. 3?", "List the requirements Rev 3 added.",
          "What requirement numbers are new in 800-171r3?", "New requirements in Revision 3?"],
         f"These {len(new)} requirement numbers are new in Rev 3:\n\n" + "\n".join(f"- {r['id']} – {r['title']}" for r in new)),
        (["Which requirements were withdrawn in NIST SP 800-171 Rev. 3?", "List all withdrawn Rev 3 requirements.",
          "What Rev 2 requirements were removed in Rev 3?", "Withdrawn requirements in 800-171r3?"],
         f"{len(withdrawn)} requirement numbers are withdrawn in Rev 3:\n\n" + "\n".join(
             f"- {r['id']}: {withdraw_text(r, by_id)}" for r in withdrawn)),
        (["How many organization-defined parameters are in NIST SP 800-171 Rev. 3?", "How many ODPs does Rev 3 have?",
          "Number of ODPs in 800-171r3?"],
         f"{REV} has {n_odp} organization-defined parameters across {sum(bool(r['odps']) for r in active)} requirements. "
         f"The {ODP_SRC} sets {n_dod} values for them."),
        (["What are DoD organization-defined parameters for NIST SP 800-171 Rev. 3?", "What is the DoD ODP memo?",
          "Who sets the ODP values for Rev 3 for defense contractors?", "Explain the DoD ODPs for 800-171r3."],
         "NIST SP 800-171 Rev. 3 leaves some values (time periods, frequencies, numbers, types) as organization-defined "
         f"parameters. The {ODP_SRC}, signed by the DoD CIO, sets DoD's values for them; in four instances the ODP is "
         "defined as guidance rather than a specific value."),
    ] + [([f"How does the DoD ODP memo define \"{w}\"?", f"Definition of {w} in the DoD Rev 3 ODPs?",
           f"What does \"{w}\" mean in the DoD 800-171 Rev. 3 ODP values?"], fn)
         for w, fn in ((v.split(":")[0], v) for v in footnotes.values())]:
        B.add("global", t, a, n_train=len(t) - 1)

    # 800-53 reverse lookup
    rev53 = collections.defaultdict(list)
    for r in active:
        for c in r["sp800_53"]:
            rev53[c].append(r)
    for c, rs in rev53.items():
        B.add("sp800_53_reverse", [
            "Which NIST SP 800-171 Rev. 3 requirement maps to SP 800-53 {c}?",
            "SP 800-53 {c} is a source control for which Rev 3 requirement?",
            "Where does SP 800-53 control {c} show up in 800-171r3?",
        ], f"SP 800-53 {c} is a source control for " + ", ".join(f"{r['id']} ({r['title']})" for r in rs) + f" in {REV}.",
            n_train=1, c=c)

    # reference reverse lookup
    revref = collections.defaultdict(list)
    for r in active:
        for x in r["references"]:
            revref[x["id"]].append(r)
    for x, rs in revref.items():
        B.add("reference_reverse", [
            "Which NIST SP 800-171 Rev. 3 requirements cite {x}?",
            "What is {x} and which Rev 3 requirements reference it?",
            "Where is {x} referenced in 800-171r3?",
        ], f"{x}: {refs[x]['title']}\n\nCited by {len(rs)} Rev 3 requirement{'s' if len(rs) != 1 else ''}:\n\n"
           + "\n".join(f"- {r['id']} – {r['title']}" for r in rs), n_train=1, x=x)

    # negatives
    for code, rs in fam_all.items():
        mx = max(int(r["id"].split(".")[2]) for r in rs)
        for extra in (1, 3):
            fake = f"{code}.{mx + extra:02d}"
            B.add("nonexistent", [
                "What does NIST SP 800-171 Rev. 3 requirement {fake} require?",
                "Explain Rev 3 {fake}.",
                "What are the determination statements for 800-171r3 {fake}?",
            ], f"{fake} does not exist in {REV}. The {families[code]} family runs from {rs[0]['id']} to {rs[-1]['id']}"
               f" ({len(fam_active[code])} active).", n_train=1, fake=fake)
    for bad in ("03.18.01", "03.19.02", "03.00.01", "03.20.01"):
        B.add("nonexistent", [
            "What is NIST SP 800-171 Rev. 3 requirement {b}?",
            "Explain Rev 3 {b}.",
            "What does 800-171r3 {b} say?",
        ], f"{REV} has no requirement {bad}. Its {len(families)} families are numbered 03.01 through 03.17.", n_train=1, b=bad)
    det_ids = {d["id"] for r in active for d in r["determinations"]}
    for r in rng.sample([r for r in active if len(r["determinations"]) > 1], 25):
        last = r["determinations"][-1]["id"]
        m = re.match(r"^(.*)\[(\d+)\]$", last)
        fake = f"{m.group(1)}[{int(m.group(2)) + 2:02d}]" if m else f"{last}[05]"
        if fake in det_ids:
            continue
        B.add("nonexistent_det", [
            "What does determination statement {fake} say?",
            "Explain SP 800-171A Rev. 3 objective {fake}.",
            "What is {fake}?",
        ], f"{fake} does not exist. {r['id']} ({r['title']}) has {len(r['determinations'])} determination statements; "
           f"the last is {last}.", n_train=1, rid=r["id"], fake=fake)

    # letter-answer MCQ training items (family, withdrawn/active) — never used in mcq_eval
    L = "ABCD"
    fam_codes = list(families)
    for r in active:
        opts = [r["family_name"]] + rng.sample([families[c] for c in fam_codes if c != r["family"]], 3)
        rng.shuffle(opts)
        B.add_one("mcq_train_family", f"In NIST SP 800-171 Rev. 3, which family contains \"{r['title']}\"?\n\n"
                  + "\n".join(f"{L[i]}. {o}" for i, o in enumerate(opts)) + "\n\nAnswer with the letter only.",
                  L[opts.index(r["family_name"])], rid=r["id"])
    for r in reqs:
        B.add_one("mcq_train_status", f"Is {r['id']} an active or withdrawn requirement in NIST SP 800-171 Rev. 3?\n\n"
                  "A. Active\nB. Withdrawn\n\nAnswer with the letter only.", "B" if r["withdrawn"] else "A", rid=r["id"])
    return B.items


def build_mcq(reqs, families, seed):
    rng = random.Random(seed + 1)
    L = "ABCD"
    active = [r for r in reqs if not r["withdrawn"]]
    by_id = {r["id"]: r for r in reqs}
    fam = collections.defaultdict(list)
    for r in active:
        fam[r["family"]].append(r)
    out = []

    def pool(r, k=3):
        p = [x for x in fam[r["family"]] if x["id"] != r["id"]]
        if len(p) < k:
            p += rng.sample([x for x in active if x["family"] != r["family"]], k - len(p))
        return rng.sample(p, k)

    def emit(task, stem, correct, wrong, rid):
        opts = [correct] + wrong
        rng.shuffle(opts)
        q = stem + "\n\n" + "\n".join(f"{L[i]}. {o}" for i, o in enumerate(opts)) + "\n\nAnswer with the letter only."
        out.append({"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q},
                                 {"role": "assistant", "content": L[opts.index(correct)]}],
                    "answer": L[opts.index(correct)], "meta": {"task": task, "id": rid}})

    all_vals = collections.defaultdict(list)
    for r in active:
        for x in r["dod_odps"]:
            if not x["guidance"] and len(x["value"]) < 200:
                all_vals[x["assignment"]].append(x["value"])
    for r in active:
        emit("mcq_title_to_id", f"Which NIST SP 800-171 Rev. 3 requirement is titled \"{r['title']}\"?",
             r["id"], [x["id"] for x in pool(r)], r["id"])
        emit("mcq_id_to_title", f"What is the title of NIST SP 800-171 Rev. 3 requirement {r['id']}?",
             r["title"], [x["title"] for x in pool(r)], r["id"])
        n = len(r["determinations"])
        wrong = rng.sample([x for x in range(1, max(n + 6, 9)) if x != n], 3)
        emit("mcq_determination_count", f"How many SP 800-171A Rev. 3 determination statements does {r['id']} have?",
             str(n), [str(x) for x in wrong], r["id"])
        for x in r["dod_odps"]:
            if x["guidance"] or len(x["value"]) >= 200:
                continue
            others = list(dict.fromkeys(v for v in all_vals[x["assignment"]] if v != x["value"]))
            if len(others) < 3:
                others += [v for vs in all_vals.values() for v in vs if v != x["value"] and v not in others]
            emit("mcq_dod_odp", f"Under the DoD ODP values for NIST SP 800-171 Rev. 3, what is the {x['assignment']} "
                 f"for {x['pid']} ({r['title']})?", x["value"], rng.sample(others, 3), r["id"])
    for r in reqs:
        if r["withdrawn"] and r["withdrawn_to"]:
            tgt = r["withdrawn_to"][0][1]
            wrong = rng.sample([x["id"] for x in active if x["id"] != tgt and x["id"] not in {t for _, t in r["withdrawn_to"]}], 3)
            emit("mcq_withdrawn_to", f"Withdrawn NIST SP 800-171 Rev. 3 requirement {r['id']} was incorporated into or "
                 f"addressed by which requirement?", tgt, wrong, r["id"])
    return out


def corpus(reqs):
    by_id = {r["id"]: r for r in reqs}
    docs = []
    for r in reqs:
        if r["withdrawn"]:
            t = f"{r['id']} (withdrawn) — {REV}, {r['family_name']}\n\n{withdraw_text(r, by_id)}"
            if r["rev2"]:
                t += f"\n\nIn Rev 2: {rev2_line(r['rev2'])}"
            docs.append({"id": r["id"], "text": t})
            continue
        parts = [f"{r['id']} – {r['title']}", f"{REV}. Family: {r['family_name']} ({r['family']}).",
                 f"Requirement:\n{statement(r)}"]
        if r["discussion"]:
            parts.append(f"Discussion:\n{r['discussion']}")
        parts.append("Determination statements (SP 800-171A Rev. 3):\n" + det_list(r))
        if r["odps"]:
            parts.append("Organization-defined parameters:\n" + odp_list(r))
        if r["dod_odps"]:
            parts.append("DoD ODP values:\n" + "\n".join(f"- {x['pid']} – {x['assignment']}: {x['value']}" for x in r["dod_odps"]))
        for k, lbl in (("examine", "Examine"), ("interview", "Interview"), ("test", "Test")):
            if r[k]:
                parts.append(f"{lbl} (select from):\n" + "\n".join(f"- {x}" for x in r[k]))
        if r["sp800_53"]:
            parts.append("Source controls (SP 800-53 Rev. 5): " + ", ".join(r["sp800_53"]))
        if r["references"]:
            parts.append("References:\n" + "\n".join(f"- {x['id']}: {x['title']}" for x in r["references"]))
        if r["rev2"]:
            parts.append("Rev 2 counterpart: " + rev2_line(r["rev2"]))
        else:
            parts.append("New in Rev 3 (no Rev 2 requirement with this number).")
        docs.append({"id": r["id"], "text": "\n\n".join(parts)})
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data_root", help="client/public/data (containing sp_800_171_3_0_0 and sp_800_171_2_0_0)")
    ap.add_argument("out_dir")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--valid-frac", type=float, default=0.05)
    ap.add_argument("--test-per-task", type=int, default=25)
    a = ap.parse_args()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    reqs, families, refs, footnotes = load(Path(a.data_root))
    items = build(reqs, families, refs, footnotes, a.seed)
    seen, uniq = set(), []
    for split, ex in items:
        key = tuple(m["content"] for m in ex["messages"][1:])
        if key not in seen:
            seen.add(key)
            uniq.append((split, ex))
    rng = random.Random(a.seed + 2)
    trainval = [ex for s, ex in uniq if s == "trainval"]
    test = [ex for s, ex in uniq if s == "test"]
    # a held-out phrasing must not collide with a training prompt
    train_prompts = {tuple(m["content"] for m in ex["messages"] if m["role"] == "user") for ex in trainval}
    test = [ex for ex in test if tuple(m["content"] for m in ex["messages"] if m["role"] == "user") not in train_prompts]
    rng.shuffle(trainval)
    rng.shuffle(test)
    per, capped = collections.Counter(), []
    for ex in test:
        t = ex["meta"]["task"]
        if per[t] < a.test_per_task:
            per[t] += 1
            capped.append(ex)
    n_val = max(1, int(len(trainval) * a.valid_frac))
    splits = {"train": trainval[n_val:], "valid": trainval[:n_val], "test": capped,
              "mcq_eval": build_mcq(reqs, families, a.seed)}
    for name, rows in splits.items():
        with open(out / f"{name}.jsonl", "w") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(out / "corpus.jsonl", "w") as fh:
        for d in corpus(reqs):
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")
    active = [r for r in reqs if not r["withdrawn"]]
    stats = {name: {"examples": len(rows), "by_task": dict(sorted(collections.Counter(r["meta"]["task"] for r in rows).items()))}
             for name, rows in splits.items()}
    stats["source"] = {"families": len(families), "active": len(active), "withdrawn": len(reqs) - len(active),
                       "determinations": sum(len(r["determinations"]) for r in active),
                       "odps": sum(len(r["odps"]) for r in active),
                       "dod_odp_values": sum(len(r["dod_odps"]) for r in active),
                       "new_in_rev3": sum(not r["rev2"] for r in active)}
    (out / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps({k: (v["examples"] if "examples" in v else v) for k, v in stats.items()}, indent=2))


if __name__ == "__main__":
    main()
