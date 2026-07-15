import data from "../../../public/data/sp_800_171_3_0_0/odp.json";
import { manifestV3 } from "./Framework";

/**
 * A single DoD-defined value for an organization-defined parameter (ODP) in
 * NIST SP 800-171 rev 3, as published by the DoD CIO memorandum. Identifiers
 * follow the memo's statement-level scheme (e.g. "03.01.01.f.02").
 */
export interface OdpEntry {
    id: string;
    /** The assignment placeholder the value fills, without the brackets. */
    assignment: string;
    value: string;
    /** The memo defines this ODP as guidance rather than a specified value. */
    guidance?: boolean;
    /** Keys into {@link odpFootnotes} referenced by the value text. */
    footnotes?: string[];
}

interface OdpDocument {
    source: {
        title: string;
        url: string;
        signed: string;
        authority: string;
    };
    footnotes: Record<string, string>;
    controls: Record<string, OdpEntry[]>;
}

const odp = data as OdpDocument;

export const odpSource = odp.source;
export const odpFootnotes = odp.footnotes;

/**
 * Resolve a memo identifier to the framework statement that contains its
 * assignment placeholder. Most identifiers name a statement directly, but
 * when a single statement holds several ODPs the memo numbers them past the
 * statement level (e.g. "03.01.08.a.01"/"03.01.08.a.02" both live in
 * statement "03.01.08.a"), so trailing segments are stripped until the
 * identifier matches a security requirement.
 */
const resolveStatement = (id: string): string => {
    let current = id;
    while (!manifestV3.securityRequirements.bySubSubRequirements[current]) {
        const cut = current.lastIndexOf(".");
        if (cut < 0) {
            return id;
        }
        current = current.slice(0, cut);
    }
    return current;
};

const byStatement: Record<string, OdpEntry[]> = {};
for (const entries of Object.values(odp.controls)) {
    for (const entry of entries) {
        const statement = resolveStatement(entry.id);
        (byStatement[statement] ??= []).push(entry);
    }
}

/**
 * A slice of statement text. Segments carrying an entry are the top-level
 * `[Assignment: ...]`/`[Selection: ...]` placeholder that entry's DoD value
 * fills; `text` holds the original placeholder so the UI can choose between
 * showing it and the value.
 */
export interface OdpSegment {
    text: string;
    entry?: OdpEntry;
}

/**
 * Locate the top-level bracketed placeholders in a statement. Selections can
 * nest assignments (e.g. 03.01.10.a), so brackets are depth-tracked rather
 * than regex-matched; nested placeholders belong to their outer selection,
 * which is what the memo's values replace.
 */
const findPlaceholders = (text: string): { start: number; end: number }[] => {
    const spans: { start: number; end: number }[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "[") {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (text[i] === "]") {
            depth--;
            if (depth === 0 && start >= 0) {
                const inner = text.slice(start + 1, i);
                if (/^(Assignment|Selection)/.test(inner)) {
                    spans.push({ start, end: i + 1 });
                }
                start = -1;
            }
        }
    }
    return spans;
};

const segmentsByStatement: Record<string, OdpSegment[]> = {};
for (const [statement, entries] of Object.entries(byStatement)) {
    const text =
        manifestV3.securityRequirements.bySubSubRequirements[statement]?.[0]
            ?.text ?? "";
    const spans = findPlaceholders(text);
    // Placeholders pair with memo entries in document order. If the counts
    // ever drift apart, leave the statement unfilled rather than mis-assign.
    if (spans.length !== entries.length) {
        continue;
    }
    const segments: OdpSegment[] = [];
    let pos = 0;
    spans.forEach((span, idx) => {
        if (span.start > pos) {
            segments.push({ text: text.slice(pos, span.start) });
        }
        segments.push({
            text: text.slice(span.start, span.end),
            entry: entries[idx],
        });
        pos = span.end;
    });
    if (pos < text.length) {
        segments.push({ text: text.slice(pos) });
    }
    segmentsByStatement[statement] = segments;
}

/**
 * The text of a rev 3 requirement statement (e.g. "03.01.01.h") split around
 * its ODP placeholders, or undefined when the statement has no DoD values.
 */
export const getStatementSegments = (
    subSubRequirement: string,
): OdpSegment[] | undefined => segmentsByStatement[subSubRequirement];
