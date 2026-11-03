"""
The app's draft prompt, mirrored in Python, so that training rows and eval
prompts match what the model receives in the app byte for byte.

Sources (keep in sync):
  client/src/app/llm/prompt.ts                       buildMessages
  client/src/app/components/ai/draft_job.ts          run(): statement, objectives
  client/src/app/components/security_requirements/form_elements.tsx
      The only draft entry point: one button per sub-statement, so every app
      draft is focused (focusId set, subStatements = [that sub-statement]).
  client/src/api/entities/AssessmentGuide.ts         getAssessmentGuidance

Not mirrored: review findings and document overviews (optional extras in
buildMessages). Every generated row is the no-findings, no-overviews case.
"""
import json
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "client" / "public" / "data"
MAX_STATEMENT_CHARS = 1200  # draft_job.ts

SYSTEM = (
    "You draft implementation narratives for NIST SP 800-171 / CMMC self-assessments. You describe, in present "
    "tense, what the organization does today, using only concrete details found in the evidence excerpts: their "
    "specific system names, tool names, policy titles, settings, and frequencies. The subject of your sentences is "
    "the organization, by the name the excerpts use — or \"The organization\" if they never name it. Never write "
    "\"they\" or \"the company\" for it. If the excerpts do not show something, leave it out — never speculate, "
    "never write generic compliance language, and never mention requirements, objectives, or assessments."
)

EXAMPLE = (
    "The organization issues staff standard user accounts for day-to-day applications; separate admin accounts "
    "exist for its four IT administrators only. Its help desk reviews role assignments quarterly and removes unused "
    "accounts within 30 days."
)


def build_messages(case, chunks):
    """buildMessages() for the focused, no-findings, no-overviews case."""
    objectives = ("\n" + "\n".join(f"- {o}" for o in case["objectives"]) + "\n") if case["objectives"] else ""
    obj_block = (f"\nAssessment objectives (a coverage checklist — do NOT copy their wording):{objectives}"
                 if objectives else "")
    excerpts = "\n".join(f"--- [{c['filename']}] (excerpt)\n{c['text']}" for c in chunks)
    user = f"""Context — reference material only; do not repeat any of it in your response.

Requirement {case['requirementId']} — {case['title']}
{case['statement']}
{obj_block}
Evidence excerpts:
{excerpts}

Task: in at most 120 words, describe what the organization does to meet statement {case['focusId']}, using only details from the excerpts. One or two short paragraphs of plain prose — no title, no headings, no lists, no citations, no summary sentence.

Example response (form only — never copy its words):
{EXAMPLE}

Write your response now."""
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


@lru_cache(maxsize=None)
def _guidance():
    guide = json.loads((DATA / "sp_800_171_2_0_0" / "assessment-guide-requirements.json").read_text())
    return {r["export_id"]: r for r in guide["requirements"]}


@lru_cache(maxsize=None)
def focus_cases(rev):
    """Every sub-statement draft that the app can start, for rev 2 or 3."""
    elements = json.loads((DATA / f"sp_800_171_{rev}_0_0" / "framework.json").read_text())
    elements = elements["response"]["elements"]["elements"]
    reqs = {e["element_identifier"]: e for e in elements if e["element_type"] == "requirement"}
    cases = []
    for e in elements:
        if e["element_type"] != "security_requirement" or not e["text"].strip():
            continue
        focus = e["element_identifier"][3:]  # getSubSubRequirement: drop "SR-"
        req_id = ".".join(focus.split(".")[:3])
        req = reqs.get(req_id)
        if req is None:
            continue
        statement = "\n".join(x for x in [req["text"], f"{focus}: {e['text']}"] if x)[:MAX_STATEMENT_CHARS]
        letter = focus[len(req_id) + 1:]
        # Intended behavior: Rev 2 guidance objectives only. The app looks up
        # guidance by ID alone, so today Rev 3 drafts also receive the Rev 2
        # objective of the same number (see docs/finetune-plan.md). Training
        # rows follow the intended behavior.
        objectives = []
        if rev == 2:
            g = _guidance().get(req_id)
            if g and letter in g["assessment_objectives"]:
                objectives = [g["assessment_objectives"][letter].strip()]
        cases.append({"rev": rev, "requirementId": req_id, "focusId": focus, "title": req.get("title") or "",
                      "statement": statement, "subText": e["text"], "objectives": objectives})
    return cases
