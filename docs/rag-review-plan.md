# RAG review layer for the CMMC app

> **Status: pending.** Do not implement until the embedded local model work is complete. The `LocalModel` interface in step 2 is the contract between the two efforts. All file and line references were verified on 2026-08-27.

## Context

A separate plan adds an embedded local LLM to this app. Without retrieval, that model can only summarize. This plan adds the RAG layer that turns it into a reviewer: it examines the evidence linked to a requirement against each assessment objective, gives a verdict, quotes the evidence, and cites the exact objective (for example `AC.L2-3.1.1[a]`).

Decisions made:
- **Retrieval:** BM25 over chunks of the extracted evidence text. Reuse the hand-rolled `TextIndex`. No embeddings, no new dependencies. Leave a re-ranker seam for a future embedding model.
- **First feature:** a per-objective review panel on the requirement page.
- **Model runtime:** design to a narrow `LocalModel` interface. The embedded-model plan implements it. A deterministic stub makes the RAG layer testable now.

Constraints verified in the code:
- The app is a static Next.js export plus a Tauri shell. No backend. All work must run client-side and offline.
- `TextIndex.search()` is AND-across-terms (`text_index.ts:161-175`). A 30-word objective query would return zero chunks. An OR-mode method is required.
- Evidence links exist only at the requirement level (`evidence_requirements`). Review scope is therefore per requirement.
- The CMMC citation id (`AC.L2-3.1.1`) exists only in `assessment-guide-requirements.json`. Compose the citation as `guidance.requirement.id + "[" + letter + "]"`.
- `getAssessmentGuidance(requirementId)` returns `assessment_objectives` keyed by letter and `export_id` as the join key (`client/src/api/entities/AssessmentGuide.ts:87-112`).
- IndexedDB is at version 11 with numbered migrations (`client/src/app/db.ts`). Derived stores (`evidence_text`) are never exported and are cleared on import (`export_import.tsx:220`). `EXPORT_VERSION = IDB.version`, so a schema bump moves the payload version automatically.
- No test runner exists. The repo pattern is dev-only console assertions (`utils/tier.ts:90-110`).

## New module layout

All new AI code lives in `client/src/app/ai/`, one concern per file, in the style of `client/src/app/search/`:

```
client/src/app/ai/
  model.ts        LocalModel interface, registration seam, availability gate
  stub_model.ts   deterministic dev stub
  chunker.ts      CHUNKER_VERSION, paragraph-aware chunking
  objectives.ts   revision-generic ReviewObjective enumeration
  retrieval.ts    ad-hoc BM25 chunk retrieval, re-ranker seam
  prompt.ts       PROMPT_VERSION, prompt builder, tagged-output parser
  review.ts       orchestration, fingerprinting, persistence
client/src/app/hooks/objectiveReviews.ts
client/src/app/components/objective_review.tsx
client/src/app/utils/hash.ts
```

## Steps (build in this order — each step compiles independently)

### 1. `searchAny` on `TextIndex`

Modify `client/src/app/search/text_index.ts`. Add one method; do not change `search()`:

```ts
/** Ranked OR search: each doc scores the sum of its best expansion per
 *  matching query term, times (matchedTerms / queryTerms) so broader
 *  coverage wins. For long natural-language queries where AND returns
 *  nothing. */
searchAny(query: string, limit = 10): TextIndexHit[]
```

Reuse the existing per-term loop and `matchWeight`. Union the per-term score maps instead of intersecting. BM25 IDF already deweights stopwords. About 25 lines.

### 2. `LocalModel` interface and stub

New `client/src/app/ai/model.ts`:

```ts
export interface GenerateOptions { signal?: AbortSignal; maxNewTokens?: number }

export interface LocalModel {
    readonly id: string;            // part of the review fingerprint
    readonly contextTokens: number; // prompt builder budgets against this
    generate(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;
    countTokens?(text: string): number; // optional; fall back to estimateTokens
    // embed() deliberately absent — the re-ranker seam lives in retrieval.ts
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export const MODEL_CHANGED_EVENT = "local-model-changed";
export const registerLocalModel = (m: LocalModel | undefined): void => { ... };
export const getLocalModel = (): LocalModel | undefined => { ... };

/** Single gating seam. The embedded-model plan owns tightening this. */
export const aiReviewAvailable = (requirementId: string): boolean =>
    isUnlocked(requirementId) && getLocalModel() !== undefined;
```

- Registration is a module seam (matches the module-level-cache idiom in `evidence_index.ts`), not React context. `registerLocalModel` dispatches `MODEL_CHANGED_EVENT` on `window` so panels appear when weights finish loading.
- `getLocalModel()` returns the stub when `NEXT_PUBLIC_AI_STUB === "1"` and no real model is registered (build-time inlined, same as `NEXT_PUBLIC_TIER`). Add `"dev:ai": "NEXT_PUBLIC_AI_STUB=1 next dev"` to `package.json` scripts.
- The free web build never registers a model, so the feature is implicitly desktop-only for now.

New `client/src/app/ai/stub_model.ts`: `id: "stub-1"`, `contextTokens: 4096`. `generate()` parses its own prompt for the `[SOURCE: ...]` markers. With chunks present, it streams (word by word, small `setTimeout`) a well-formed tagged verdict whose `QUOTE:` is a real substring of the first chunk. With no chunks, `VERDICT: no-evidence`. This exercises parse → persist → render including quote verification.

### 3. Chunker

New `client/src/app/ai/chunker.ts`:

```ts
export const CHUNKER_VERSION = 1; // part of the review fingerprint
export interface EvidenceChunk {
    id: string;        // "{evidenceId}#{seq}" — doc id and citation ref
    evidenceId: string;
    seq: number;
    text: string;
}
export const chunkText = (evidenceId: string, text: string): EvidenceChunk[]
```

- Split on newlines into paragraphs (the extractors already emit one line per paragraph, page, or row). Pack paragraphs greedily to ~1,400 chars (~350 tokens), hard cap ~2,000. Split oversized paragraphs at sentence boundaries, then hard-split. Carry the last paragraph (capped ~300 chars) into the next chunk as overlap.
- **No chunk store, no migration for chunks.** Scope is the evidence of one requirement — a handful of files at ≤500KB text each. Chunk on the fly at review time; the cost is milliseconds. `CHUNKER_VERSION` only feeds the staleness fingerprint.

### 4. Objective enumeration

New `client/src/app/ai/objectives.ts`:

```ts
export interface ReviewObjective {
    id: string;                   // storage key, "03.01.01.a"
    requirementId: string;
    citation: string;             // "AC.L2-3.1.1[a]" (Rev 2)
    anchorId: string;             // "03.01.01.a" — form_elements.tsx renders these ids
    text: string;                 // objective prose (ODPs resolved for Rev 3)
    requirementStatement: string;
    methodTerms: string[];        // examine-method vocabulary for the query
}
export const objectivesForRequirement = (revision: Revision, requirementId: string): ReviewObjective[]
```

- **Rev 2 (phase 1):** iterate `getAssessmentGuidance(requirementId).requirement.assessment_objectives`; `citation = requirement.id + "[" + letter + "]"`; `methodTerms = assessment_methods.examine` (document names like "Access control policy" match evidence filenames and headings). Return `[]` when no guidance exists (withdrawn controls) — the panel then renders nothing.
- **Rev 3 (phase 2):** enumerate `determination` elements from `manifestV3`, substitute ODP placeholders via `OrganizationDefinedParameters.ts`, cite by the determination id. Same output shape; nothing downstream changes.
- Do not touch `framework_index.ts` — its per-requirement objective collapsing is a search-UI concern, not on this path.

### 5. Retrieval

New `client/src/app/ai/retrieval.ts`:

- `buildChunkIndex(docs: EvidenceTextDoc[])` → `{ index, chunksById }`: chunk all texts, build one `new TextIndex(["text", "filename"], { filename: 2 })` per run (all objectives of a requirement share it).
- `retrieveForObjective(objective, handle, limit = 8): RetrievedChunk[]`: query = objective text + requirement statement + method terms, via `searchAny`, over-fetching `limit * 2` so the prompt builder can drop chunks that do not fit the budget.
- Re-ranker seam: `setReranker(r: Reranker | undefined)`, identity by default. This is where a future embedding model plugs in without touching callers.

### 6. Prompt builder and parser

New `client/src/app/ai/prompt.ts` (`PROMPT_VERSION = 1`, part of the fingerprint):

Prompt shape (single string; chat templating belongs to the runtime behind `generate()`):

```
You are a CMMC assessor reviewing evidence for one assessment objective.

Requirement 03.01.01: Limit system access to authorized users, ...
Objective AC.L2-3.1.1[a]: authorized users are identified

Evidence excerpts (the only material you may rely on):
[SOURCE: access-control-policy.docx#2]
...chunk text...

Decide whether the evidence demonstrates this objective. Respond with exactly
these lines and nothing else:
VERDICT: met | partially-met | not-met | no-evidence
CITATION: AC.L2-3.1.1[a]
QUOTE: <verbatim sentence copied from one excerpt> (SOURCE: <filename#n>)
REASON: <one or two sentences naming what is present or missing>
If no excerpt is relevant, use VERDICT: no-evidence and omit QUOTE.
```

- Budget: `contextTokens − fixed prompt tokens − 256 output reserve`; add chunks in score order while they fit (`countTokens` when available, else `estimateTokens`). Always include at least one chunk, truncated, when evidence exists.
- **Tagged lines, not JSON:** 1–3B local models emit broken JSON often, and this prompt asks the model to quote text that contains quotes. Each tagged field parses independently with a line regex; a malformed field degrades that field, not the run.
- Parser `parseReviewResponse(raw, objective, included)`: case-insensitive line-anchored regexes; verdict synonyms normalized; unknown → verdict `"unparsed"` with `raw` preserved. **Quote verification:** whitespace-normalized substring check against the included chunks. Verified quotes resolve to `{evidenceId, seq, filename}`; unverified quotes are kept but flagged `verified: false` so the UI labels them instead of presenting a hallucination as evidence.

### 7. Persistence — DB migration 12

Modify `client/src/app/db.ts`: `version = 12`; migration `"12"` creates store `objective_reviews` (keyPath `objective_id`, index `requirement_id`). New interface + `IDB.objectiveReviews` StoreWrapper:

```ts
/** Derived data (evidence + model output): never exported; cleared on import;
 *  staleness detected via `fingerprint`. */
export interface IDBObjectiveReview {
    objective_id: string;   // "03.01.01.a" — one row per objective, latest wins
    requirement_id: string;
    citation: string;
    verdict: "met" | "partially-met" | "not-met" | "no-evidence" | "unparsed" | "error";
    reason: string;
    quote?: { text: string; evidence_id: string; chunk: number; filename: string; verified: boolean };
    raw: string;            // for the "unparsed" fallback display
    fingerprint: string;    // sha256(sorted evidence ids + EXTRACTOR_VERSION + CHUNKER_VERSION + PROMPT_VERSION + model id)
    model: string;
    created: number;
}
```

- New `client/src/app/utils/hash.ts`: 4-line `crypto.subtle` `sha256Hex` helper (leave `db.ts`'s private copy alone).
- Modify `client/src/app/components/export_import.tsx`: add `await IDB.objectiveReviews.clear();` next to the `evidence_text` clear at line 220. Do not add reviews to the export payload. `EXPORT_VERSION` follows `IDB.version` automatically (precedent: migrations 6 and 10).

### 8. Orchestration

New `client/src/app/ai/review.ts` — `reviewRequirement(revision, requirementId, { signal, onProgress })`:

1. Module-level `inFlight` guard (same coalescing idiom as `evidence_text_store.ts`) — one run app-wide.
2. `await ensureEvidenceTextSynced()`.
3. Load linked evidence via `IDB.evidenceRequirements` (index `requirement_id`), then `evidence` metadata and `evidence_text` rows. Exclude rows with `status !== "ok"` from retrieval but report the count to the UI.
4. Chunk once, build the shared chunk index, compute the fingerprint once.
5. Per objective, **sequentially**: retrieve → build prompt → stream `generate()` (abort via `signal`) → parse → `IDB.objectiveReviews.put(row)` immediately. Partial runs persist per objective; `TABLE_CHANGED_EVENT` updates the UI row by row. A thrown `generate()` persists verdict `"error"` with the message in `raw` and continues.

New `client/src/app/hooks/objectiveReviews.ts` — `useObjectiveReviews(requirementId)`: reads via the `requirement_id` index; re-reads on `TABLE_CHANGED_EVENT` for `objective_reviews`, `evidence`, `evidence_requirements`, `evidence_text`; also computes the current expected fingerprint and returns `{ reviews, stale }`. Same shape as `hooks/db.ts`.

### 9. UI panel

New `client/src/app/components/objective_review.tsx` — `<ObjectiveReview requirementId locked />`, modeled on `assessment_guidance.tsx`:

- Render `null` unless objectives exist and `aiReviewAvailable(requirementId)` (with a `useLocalModel()` mini-hook on `MODEL_CHANGED_EVENT`). `locked` disables the run button, same threading as `AssessmentGuidance`.
- `<details>/<summary>` collapsible "Evidence Review (AI)": summary badge `met/total`, plus a "Stale" badge on fingerprint mismatch.
- Body: disclaimer line (generated locally by a small on-device model; assessor guidance, not an assessment); Run/Re-run button; progress text and Stop (AbortController); muted note when N linked files had no extractable text.
- Per-objective rows: citation chip as `<a href={"#" + anchorId}>` around a Badge (same anchor contract as `linkifyObjectives`, `assessment_guidance.tsx:84-96`); verdict badge (met → success, partially-met → warning, not-met → destructive-styled, else neutral); objective text; REASON; quote as a bordered blockquote with filename and an "unverified" tag when applicable; `unparsed` renders `raw` in a `<pre>`.
- Open-evidence affordance: add `id={"evidence-" + artifact.id}` to artifact rows in `components/security_requirements/evidence.tsx`; link the quote's filename to `#evidence-{id}`.
- Mount: `components/security_requirements/security_requirement.tsx`, directly after `<AssessmentGuidance …/>` (line 239).

## Phasing

- **Phase 1:** Rev 2 with the stub model (steps 1–9 above).
- **Phase 2:** Rev 3 branch of `objectives.ts` (determinations + ODP substitution). Nothing else changes.
- **Phase 3 (after the embedded model lands):** register the real `LocalModel`; optionally an embedding re-ranker via `setReranker`. The embedding part is replaced by embedding retrieval (`docs/embedding-retrieval-plan.md`): the embedder ranks all chunks, and BM25 is the fallback. `setReranker` stays as the hook for a cross-encoder.

## Risks

- Skipping `searchAny` breaks the feature: AND retrieval returns zero chunks for nearly every objective (verified in `text_index.ts`).
- Small-model output reliability: mitigated by the tagged format, tolerant parser, `unparsed` fallback, and quote verification.
- Stale verdicts: fingerprint covers evidence ids, all pipeline versions, and model id; the hook surfaces "Stale".
- `no-evidence` over unextractable files would mislead: the excluded-file count is surfaced in the panel.
- The service worker needs no changes: this plan adds no network fetches and no new public assets.

## Verification

No test runner exists (`package.json`: dev/build/lint/tauri only). Do not add one.

1. Dev-only console assertions (pattern: `tier.ts:90`), guarded by `NODE_ENV !== "production"`: chunker round-trip and size bounds; parser golden good / mangled / junk → `unparsed`.
2. Manual E2E with the stub: `NEXT_PUBLIC_AI_STUB=1 npm run dev` → `/r2/requirement/03.01.01` → attach a text or PDF artifact → Run review. Confirm: rows appear incrementally; citations read `AC.L2-3.1.1[a]`…, and anchor-scroll to the form statements; the quote matches the uploaded file and its filename anchors to the evidence row; changing evidence flips the panel to "Stale"; export → import clears reviews; Stop mid-run keeps completed rows.
3. Negative paths: `npm run dev` without the stub flag → panel absent; `NEXT_PUBLIC_TIER=free NEXT_PUBLIC_AI_STUB=1` → locked requirements show the panel disabled.
4. Build gates: `npm run build` (static export must succeed) and `npm run lint`.

## Critical files

- `client/src/app/search/text_index.ts` — add `searchAny`
- `client/src/app/db.ts` — migration 12, `objective_reviews`, `IDBObjectiveReview`
- `client/src/api/entities/AssessmentGuide.ts` — objective + citation source (read-only)
- `client/src/app/components/assessment_guidance.tsx` — UI pattern + anchor contract to imitate
- `client/src/app/components/security_requirements/security_requirement.tsx` — mount point (line 239)
- `client/src/app/components/export_import.tsx` — clear derived reviews on import (line 220)
