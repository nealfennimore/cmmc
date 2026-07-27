"use client";
import { assessmentObjectivesByRequirement } from "@/api/entities/AssessmentGuide";
import {
    ElementWrapper,
    Manifest,
    manifestV2,
    manifestV3,
} from "@/api/entities/Framework";
import { Revision } from "@/app/context/revision";
import { isUnlocked } from "@/app/utils/tier";
import { TextIndex } from "./text_index";

export type FrameworkMatchKind =
    | "requirement"
    | "security_requirement"
    | "discussion"
    | "determination"
    | "odp"
    | "objective";

export interface FrameworkHit {
    requirementId: string;
    /** The requirement's title, for the result label. */
    title: string;
    /** Which element the query matched, for the "Matched in …" sublabel. */
    matchKind: FrameworkMatchKind;
    score: number;
}

interface DocMeta {
    requirementId: string;
    kind: FrameworkMatchKind;
}

interface FrameworkSearch {
    index: TextIndex;
    meta: Map<string, DocMeta>;
    manifest: Manifest;
}

// Map an element to the requirement page that should open when it matches.
// Requirement/security_requirement/discussion use the shared getRequirement
// slices via ElementWrapper; determinations ("DS-A.03.14.01.a[01]") and ODPs
// ("A.03.01.01.ODP[06]") are Rev 3-only shapes with their own offsets.
const requirementIdFor = (element: ElementWrapper): string => {
    switch (element.element_type) {
        case "determination":
            return element.element_identifier.slice(5, 13);
        case "odp":
            return element.element_identifier.slice(2, 10);
        default:
            return element.requirement;
    }
};

const INDEXED_KINDS = new Set([
    "requirement",
    "security_requirement",
    "discussion",
    "determination",
    "odp",
]);

const build = (revision: Revision): FrameworkSearch => {
    const manifest = revision === Revision.V2 ? manifestV2 : manifestV3;
    // Identifier gets the top boost so typing a control id (or its family
    // prefix) beats prose that merely mentions it; titles beat body text.
    const index = new TextIndex(["identifier", "title", "text"], {
        identifier: 4,
        title: 3,
    });
    const meta = new Map<string, DocMeta>();

    const addDoc = (
        id: string,
        docMeta: DocMeta,
        content: { identifier?: string; title?: string; text?: string },
    ) => {
        // Withdrawn or unknown targets have no page to open; on the free
        // tier, locked requirements are excluded at build time (FREE_TIER is
        // inlined, so full builds skip the check entirely).
        if (
            !manifest.requirements.byId[docMeta.requirementId] ||
            !isUnlocked(docMeta.requirementId)
        ) {
            return;
        }
        index.add(id, content);
        meta.set(id, docMeta);
    };

    for (const element of manifest.elements) {
        const kind = element.element_type as FrameworkMatchKind;
        if (!INDEXED_KINDS.has(kind) || !(element.title || element.text)) {
            continue;
        }
        addDoc(
            element.element_identifier,
            { requirementId: requirementIdFor(element), kind },
            {
                identifier: element.element_identifier,
                title: element.title,
                text: element.text,
            },
        );
    }

    // Rev 2 assessment objectives live outside the framework file; one doc
    // per requirement. Rev 3 determinations play the same role natively.
    if (revision === Revision.V2) {
        for (const [requirementId, text] of Object.entries(
            assessmentObjectivesByRequirement,
        )) {
            addDoc(
                `objective:${requirementId}`,
                { requirementId, kind: "objective" },
                { text },
            );
        }
    }

    return { index, meta, manifest };
};

// Built on first query, not app load: search is an occasional feature and
// the family pages shouldn't pay for tokenizing ~1,100 docs up front.
const cache = new Map<Revision, FrameworkSearch>();
const getFrameworkSearch = (revision: Revision): FrameworkSearch => {
    let handle = cache.get(revision);
    if (!handle) {
        handle = build(revision);
        cache.set(revision, handle);
    }
    return handle;
};

// "3.1.1", "03.01", "13" — treat as a control id prefix lookup.
const ID_QUERY = /^\d{1,2}(\.\d{0,2}){0,2}\.?$/;

const idPrefixMatches = (manifest: Manifest, query: string): string[] => {
    const prefix = query
        .replace(/\.$/, "")
        .split(".")
        .map((segment) => segment.padStart(2, "0"))
        .join(".");
    return Object.keys(manifest.requirements.byId)
        .filter((id) => id.startsWith(prefix) && isUnlocked(id))
        .sort();
};

/** Ranked framework search, aggregated to one hit per requirement page. */
export const searchFramework = (
    revision: Revision,
    query: string,
    limit = 8,
): FrameworkHit[] => {
    const trimmed = query.trim();
    if (!trimmed) {
        return [];
    }
    const { index, meta, manifest } = getFrameworkSearch(revision);

    const titleFor = (requirementId: string): string =>
        manifest.requirements.byId[requirementId]?.title ?? "";

    const byRequirement = new Map<string, FrameworkHit>();

    // Exact-shape id queries jump straight to prefix matches on requirement
    // ids, ahead of anything ranked (Infinity keeps them pinned on merge).
    if (ID_QUERY.test(trimmed)) {
        for (const requirementId of idPrefixMatches(manifest, trimmed)) {
            byRequirement.set(requirementId, {
                requirementId,
                title: titleFor(requirementId),
                matchKind: "requirement",
                score: Infinity,
            });
        }
    }

    // Over-fetch so aggregation by requirement still fills the limit when
    // several element hits collapse onto the same page. Hits arrive sorted
    // by score, so the first per requirement is its best match.
    for (const hit of index.search(trimmed, limit * 6)) {
        const docMeta = meta.get(hit.id);
        if (!docMeta || byRequirement.has(docMeta.requirementId)) {
            continue;
        }
        byRequirement.set(docMeta.requirementId, {
            requirementId: docMeta.requirementId,
            title: titleFor(docMeta.requirementId),
            matchKind: docMeta.kind,
            score: hit.score,
        });
    }

    return [...byRequirement.values()]
        .sort(
            (a, b) =>
                b.score - a.score ||
                a.requirementId.localeCompare(b.requirementId),
        )
        .slice(0, limit);
};
