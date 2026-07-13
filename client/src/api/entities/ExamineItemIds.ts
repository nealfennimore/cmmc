import examineSharedItems from "../../../public/data/sp_800_171_2_0_0/examine-shared-items.json";

/**
 * Identity layer for "Examine" evidence items: canonical names, frozen slug
 * ids, and the reviewed shared-document flags, all sourced from
 * examine-shared-items.json. Persisted rows (evidence tags, checklist ticks)
 * reference the id, never a name: names may be reworded as the dedup mapping
 * evolves, ids must not change.
 *
 * Kept separate from ExamineItems.ts (which builds the per-revision indexes)
 * so the DB layer can import it without dragging the framework and guide
 * JSON blobs into every bundle.
 */

// The guide names the same artifact with slightly different strings on
// different controls (variant -> canonical). Without merging them, evidence
// attached under one spelling never propagates to controls using the other.
const CANONICAL_ITEMS: Record<string, string> = {
    "Any other relevant documents or records":
        "Other relevant documents or records",
    "Facility diagram/layout": "Facility diagram or layout",
    "Access control policy": "Access control policy and procedures",
    "Configuration management policy":
        "Configuration management policy and procedures",
    "Physical and environmental protection policy":
        "Physical and environmental protection policy and procedures",
    "Security planning policy": "Security planning policy and procedures",
    "Physical access logs or records":
        "Physical access control logs or records",
    "Procedures addressing wireless implementation and usage (including restrictions)":
        "Procedures addressing wireless access implementation and usage (including restrictions)",
    "Procedures addressing audit review, analysis, and reporting":
        "Procedures addressing audit record review, analysis, and reporting",
    "Procedures addressing access control for mobile device usage (including restrictions)":
        "Procedures addressing access control for mobile devices",
    "Relevant codes of federal regulations": "Codes of federal regulations",
    "Security plan": "System security plan",
    "Organizational procedures addressing system security plan development and implementation":
        "Procedures addressing system security plan development and implementation",
    "Cryptographic mechanisms":
        "Cryptographic mechanisms and associated configuration documentation",
    "Encryption mechanisms and associated configuration documentation":
        "Cryptographic mechanisms and associated configuration documentation",
    "Baseline configuration": "System baseline configuration",
    "Procedures addressing system maintenance tools and media":
        "Procedures addressing system maintenance tools",
    "Procedures addressing identification and authentication":
        "Procedures addressing user identification and authentication",
};

// Guide entries that jam two artifacts into one string.
const SPLIT_ITEMS: Record<string, string[]> = {
    "System security plan, system design documentation": [
        "System security plan",
        "System design documentation",
    ],
    "System configuration settings and associated documentation, system audit logs and records":
        [
            "System configuration settings and associated documentation",
            "System audit logs and records",
        ],
};

export const canonicalize = (items: string[]): string[] =>
    items
        .flatMap((item) => SPLIT_ITEMS[item] ?? [item])
        .map((item) => CANONICAL_ITEMS[item] ?? item);

/**
 * Items reviewed as genuinely shareable across controls. Not every recurring
 * Examine string names a single organization-wide artifact: "System security
 * plan" is one document everywhere it appears, but "System audit logs and
 * records" is control-specific even though the wording repeats. The JSON
 * mapping (keyed by canonical item name) carries the human-reviewed `shared`
 * flag plus the controls listing each item.
 */
export const SHARED_EXAMINE_ITEMS: ReadonlySet<string> = new Set(
    Object.entries(examineSharedItems)
        .filter(([, entry]) => entry.shared)
        .map(([item]) => item),
);

const itemIdByName = new Map(
    Object.entries(examineSharedItems).map(([item, entry]) => [
        item,
        entry.id,
    ]),
);
const itemNameById = new Map(
    Object.entries(examineSharedItems).map(([item, entry]) => [
        entry.id,
        item,
    ]),
);

/** Frozen examine id for a canonical item name (undefined for unknown names,
 *  e.g. Rev. 3 items with no reviewed entry). */
export const examineItemId = (item: string): string | undefined =>
    itemIdByName.get(item);

/** Canonical display name for a stored examine id. */
export const examineItemName = (examineId: string): string | undefined =>
    itemNameById.get(examineId);

/** Frozen examine ids for one guide item string (raw or canonical). Compound
 *  guide entries yield one id per component; unknown items yield none. */
export const examineItemIdsForItem = (item: string): string[] =>
    canonicalize([item])
        .map((canonical) => itemIdByName.get(canonical))
        .filter((id): id is string => !!id);

/** Ids to persist for one checklist item string. Every Rev. 2 guide string
 *  maps, so the raw-string fallback only fires for foreign data (hand-edited
 *  imports); carrying it verbatim keeps such ticks lossless. */
export const examineIdsForStoredItem = (item: string): string[] => {
    const ids = examineItemIdsForItem(item);
    return ids.length ? ids : [item];
};
