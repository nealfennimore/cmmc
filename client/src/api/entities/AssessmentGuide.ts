import {
    AssessmentGuide,
    AssessmentGuideRequirement,
    AssessmentMethods,
} from "@/api/generated/AssessmentGuide";
import dataV2 from "../../../public/data/sp_800_171_2_0_0/assessment-guide-requirements.json";

/**
 * The raw `further_discussion` blob bundles a few distinct sections into one
 * string, with the section label trailing the paragraph that precedes it
 * (e.g. "...for access control. Example 1"). Split it back into structured
 * parts so the UI can render them as proper headings.
 */
export interface FurtherDiscussion {
    /** Intro paragraphs explaining the requirement in plain language. */
    overview: string[];
    /** Worked scenarios illustrating the requirement. */
    examples: string[];
    /** "Potential Assessment Considerations" — individual checklist questions. */
    considerations: string[];
}

/** Split a run-on block of considerations into individual questions. */
const splitQuestions = (paragraphs: string[]): string[] =>
    paragraphs
        .flatMap((paragraph) => paragraph.split(/(?<=\?)\s+(?=[A-Z(])/))
        .map((question) => question.trim())
        .filter(Boolean);

export interface AssessmentGuidance {
    requirement: AssessmentGuideRequirement;
    furtherDiscussion: FurtherDiscussion;
    assessmentMethods: AssessmentMethods;
    keyReferences: string[];
}

const guideV2 = dataV2 as AssessmentGuide;

export const assessmentGuideSource = guideV2.source;

/** The published document the guide data was extracted from. */
export const assessmentGuideSourceUrl =
    "https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL2v2.pdf";

// Matches a trailing section label so we can both strip it from the current
// paragraph and use it to decide which section the next paragraph belongs to.
const SECTION_MARKER =
    /\s*(Example\s*\d*|Potential Assessment Considerations)\s*$/;

const parseFurtherDiscussion = (text: string): FurtherDiscussion => {
    const overview: string[] = [];
    const examples: string[] = [];
    const considerations: string[] = [];
    const sections = { overview, example: examples, considerations };

    let section: keyof typeof sections = "overview";

    for (const paragraph of text.split("\n")) {
        const trimmed = paragraph.trim();
        if (!trimmed) {
            continue;
        }

        const marker = trimmed.match(SECTION_MARKER);
        const content = marker
            ? trimmed.replace(SECTION_MARKER, "").trim()
            : trimmed;

        if (content) {
            sections[section].push(content);
        }

        if (marker) {
            section = marker[1].startsWith("Potential")
                ? "considerations"
                : "example";
        }
    }

    return {
        overview,
        examples,
        considerations: splitQuestions(considerations),
    };
};

const guidanceByRequirement: Record<string, AssessmentGuidance> =
    Object.freeze(
        guideV2.requirements.reduce(
            (acc, requirement) => {
                acc[requirement.export_id] = {
                    requirement,
                    furtherDiscussion: parseFurtherDiscussion(
                        requirement.further_discussion,
                    ),
                    assessmentMethods: requirement.assessment_methods,
                    keyReferences: requirement.key_references,
                };
                return acc;
            },
            {} as Record<string, AssessmentGuidance>,
        ),
    );

/**
 * Look up assessor guidance for a requirement by its framework element
 * identifier (e.g. "03.01.01"). Returns `undefined` for requirements without
 * guidance (all of Rev. 3, and any withdrawn Rev. 2 controls).
 */
export const getAssessmentGuidance = (
    requirementId: string,
): AssessmentGuidance | undefined => guidanceByRequirement[requirementId];
