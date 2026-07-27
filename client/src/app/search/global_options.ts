"use client";
import { Option } from "@/app/components/search_dropdown";
import { Revision } from "@/app/context/revision";
import { searchEvidence } from "./evidence_index";
import { FrameworkMatchKind, searchFramework } from "./framework_index";

// Shared between the inline family-page search and the Ctrl+K palette so the
// two surfaces always rank, label, and navigate identically.

export type GlobalSearchValue =
    | { type: "requirement"; id: string }
    | { type: "evidence"; query: string };

const MATCH_LABELS: Record<FrameworkMatchKind, string | undefined> = {
    requirement: undefined, // Matched the requirement itself — no sublabel.
    security_requirement: "Matched in a security requirement",
    discussion: "Matched in the discussion",
    determination: "Matched in an assessment objective",
    odp: "Matched in an organization-defined parameter",
    objective: "Matched in an assessment objective",
};

const FRAMEWORK_LIMIT = 6;
const EVIDENCE_LIMIT = 3;

/** Ranked options across the revision's requirements and the user's
 *  evidence; every option's value is a {@link GlobalSearchValue}. */
export const globalSearchOptions = async (
    revision: Revision,
    query: string,
): Promise<Option[]> => {
    const requirementOptions = searchFramework(
        revision,
        query,
        FRAMEWORK_LIMIT,
    ).map((hit) => ({
        label: `${hit.requirementId} — ${hit.title}`,
        value: {
            type: "requirement",
            id: hit.requirementId,
        } satisfies GlobalSearchValue,
        sublabel: MATCH_LABELS[hit.matchKind],
    }));
    const evidenceOptions = (await searchEvidence(query, EVIDENCE_LIMIT)).map(
        (hit) => ({
            label: hit.filename,
            value: { type: "evidence", query } satisfies GlobalSearchValue,
            sublabel: "Evidence",
        }),
    );
    return [...requirementOptions, ...evidenceOptions];
};

/** Where a selected option navigates: the requirement page, or the evidence
 *  table pre-filtered to the query. */
export const globalSearchHref = (
    path: string,
    value: GlobalSearchValue,
): string =>
    value.type === "requirement"
        ? `${path}/requirement/${value.id}`
        : `${path}/evidence?q=${encodeURIComponent(value.query)}`;
