import {
    canonicalize,
    SHARED_EXAMINE_ITEMS,
} from "@/api/entities/ExamineItemIds";
import { frameworkV3 } from "@/api/entities/Framework";
import { AssessmentGuide } from "@/api/generated/AssessmentGuide";
import { ElementType } from "@/api/generated/Framework";
import guideDataV2 from "../../../public/data/sp_800_171_2_0_0/assessment-guide-requirements.json";

/**
 * "Examine" evidence items — the named documents/records an assessor reviews
 * (e.g. "System security plan") — recur across controls, so a single artifact
 * often satisfies the same item everywhere it appears. This module indexes
 * item name -> controls (and the reverse) per revision so evidence attached to
 * one control can be propagated to every control sharing the item.
 *
 * Sources differ by revision: Rev. 2 items come from the assessment guide
 * (the strings the Examine checklist renders, but with near-duplicate
 * spellings merged so sharing works across variant wording); Rev. 3 has no
 * published guide,
 * but its framework carries one `examine` element per requirement with a
 * "[SELECT FROM: a; b; c]" text blob that parses into the same kind of list.
 */
interface ExamineIndex {
    itemsByRequirement: Record<string, string[]>;
    requirementsByItem: Record<string, string[]>;
}

const buildIndex = (entries: Array<[string, string[]]>): ExamineIndex => {
    const itemsByRequirement: Record<string, string[]> = {};
    const requirementsByItem: Record<string, string[]> = {};

    for (const [requirementId, items] of entries) {
        for (const item of canonicalize(items)) {
            if (!itemsByRequirement[requirementId]) {
                itemsByRequirement[requirementId] = [];
            }
            if (!itemsByRequirement[requirementId].includes(item)) {
                itemsByRequirement[requirementId].push(item);
            }
            // Only reviewed-as-shareable items enter the sharing index; a
            // recurring name is not enough (e.g. "System audit logs and
            // records" is control-specific despite appearing everywhere).
            if (!SHARED_EXAMINE_ITEMS.has(item)) {
                continue;
            }
            if (!requirementsByItem[item]) {
                requirementsByItem[item] = [];
            }
            if (!requirementsByItem[item].includes(requirementId)) {
                requirementsByItem[item].push(requirementId);
            }
        }
    }

    return Object.freeze({ itemsByRequirement, requirementsByItem });
};

const guideV2 = guideDataV2 as AssessmentGuide;

const indexV2 = buildIndex(
    guideV2.requirements.map((requirement): [string, string[]] => [
        requirement.export_id,
        requirement.assessment_methods.examine,
    ]),
);

// "[SELECT FROM: access control policy; system security plan]" -> item list,
// sentence-cased to match the Rev. 2 guide's style.
const parseSelectFrom = (text: string): string[] =>
    text
        .replace(/^\s*\[?\s*SELECT FROM:\s*/i, "")
        .replace(/\]\s*$/, "")
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.charAt(0).toUpperCase() + item.slice(1));

const indexV3 = buildIndex(
    frameworkV3.response.elements.elements
        .filter((element) => element.element_type === ElementType.Examine)
        // "E-03.14.01" -> "03.14.01"
        .map((element): [string, string[]] => [
            element.element_identifier.slice(2),
            parseSelectFrom(element.text),
        ]),
);

const forRevision = (revision: number): ExamineIndex =>
    revision === 2 ? indexV2 : indexV3;

/** Examine items listed for a control, in guide order. */
export const examineItemsForRequirement = (
    revision: number,
    requirementId: string,
): string[] => forRevision(revision).itemsByRequirement[requirementId] ?? [];

/**
 * Every control whose Examine list contains the item (the control itself
 * included). Empty unless the item was reviewed as genuinely shareable
 * ({@link SHARED_EXAMINE_ITEMS}).
 */
export const requirementsSharingExamineItem = (
    revision: number,
    item: string,
): string[] => forRevision(revision).requirementsByItem[item] ?? [];
