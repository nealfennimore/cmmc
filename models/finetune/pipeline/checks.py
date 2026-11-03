"""
Rule checks for a draft narrative. evaluate.py scores with them, and
gen_drafts.py rejects teacher drafts that fail them. The rules come from the
app's draft system prompt (app_prompt.SYSTEM).
"""
import re

ID_RE = re.compile(r"\b(?:[A-Z]{2}\.L[12]-)?3\.\d{1,2}\.\d{1,2}(?:\[[a-z]\])?|\b(?:A\.)?03\.\d{2}\.\d{2}[\w.\[\]]*")
LEAK_RE = re.compile(r"\b(requirements?|objectives?|assessments?|assessors?|NIST|CMMC|SP 800-171|compliance|compliant)\b",
                     re.I)
# The app rule: never write "they" or "the company" for the organization.
PRONOUN_RE = re.compile(r"\b(they|the company)\b", re.I)
FORMAT_RE = re.compile(r"^\s*(#|[-*•]\s|\d+[.)]\s)|\*\*", re.M)
# Words that start sentences or join names. They are not evidence details.
COMMON = {"The", "Its", "It", "This", "These", "Each", "Every", "All", "When", "After", "Before", "Both", "For", "In",
          "On", "At", "Only", "Staff", "Users", "New", "Any", "If", "Once", "During", "Within", "As", "And", "A", "An",
          "No", "To", "They", "Their", "Access", "Accounts", "Changes", "Logs", "Separate", "Requests", "Employees", "Personnel"}
# Generic IT terms: naming one is not an invented fact about the organization.
COMMON |= {"IT", "SSO", "MFA", "VPN", "VPNs", "IPS", "IDS", "IP", "IPs", "MAC", "ID", "IDs", "IdP", "IAM", "CUI", "OS",
           "USB", "PIN", "PIV", "API", "DNS", "TLS", "SSH", "RDP", "LAN", "Wi", "Fi", "Windows", "macOS", "Linux", "HQ",
           "PC", "PCs", "SaaS", "EDR", "SIEM", "MDM", "GPO", "HR", "CEO", "CFO", "CTO", "CISO", "ISSO"}


def details(text):
    """Numbers and capitalized words: the specifics a draft must not invent.
    Checked word by word (hyphen and slash parts separately), so that two real
    names side by side, or a hyphenated word whose parts both occur in the
    evidence, do not count as an invention."""
    found = set()
    for token in re.findall(r"[A-Za-z0-9][\w.%:/-]*", text):
        token = token.rstrip(".:-/")
        if not token or not (token[0].isupper() or token[0].isdigit()) or token in COMMON:
            continue
        found.update(p for p in re.split(r"[-/]", token) if p and p not in COMMON)
    return found


def check(draft, chunks, max_words=120):
    evidence = " ".join(c["text"] for c in chunks).lower()
    ungrounded = sorted(d for d in details(draft) if d.lower() not in evidence)
    return {
        "words": len(draft.split()),
        "id_leaks": sorted(set(ID_RE.findall(draft))),
        "term_leaks": sorted({m.lower() for m in LEAK_RE.findall(draft)}),
        "pronouns": sorted({m.lower() for m in PRONOUN_RE.findall(draft)}),
        "formatting": bool(FORMAT_RE.search(draft)),
        "too_long": len(draft.split()) > max_words,
        "ungrounded": ungrounded,
    }


def passes(result):
    """Strict gate for training targets."""
    return not (result["id_leaks"] or result["term_leaks"] or result["pronouns"] or result["formatting"]
                or result["too_long"] or result["ungrounded"] or result["words"] < 15)
