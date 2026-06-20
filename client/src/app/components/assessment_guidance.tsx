"use client";
import {
    assessmentGuideSource,
    getAssessmentGuidance,
} from "@/api/entities/AssessmentGuide";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { useExamineEvidence } from "@/app/hooks/examineEvidence";
import { ReactNode } from "react";
import { IconInfo } from "./icon_info";
import { Popover } from "./popover";
import { Badge, Heading } from "./ui";

type Method = "Examine" | "Interview" | "Test";

// Definitions of the three assessment methods, per NIST SP 800-171A, each with
// a concrete illustration of how the method is applied.
const METHOD_DESCRIPTIONS: Record<Method, { description: string; example: string }> = {
    Examine: {
        description:
            "The process of reviewing, inspecting, observing, studying, or analyzing assessment objects (e.g., policies, procedures, plans, system designs, mechanisms) to facilitate understanding, achieve clarification, or obtain evidence.",
        example:
            "An assessor reads the access control policy and inspects system configuration settings to confirm they match.",
    },
    Interview: {
        description:
            "The process of holding discussions with individuals or groups within an organization to facilitate understanding, achieve clarification, or identify the location of evidence.",
        example:
            "An assessor asks a system administrator to describe how user accounts are approved, reviewed, and disabled.",
    },
    Test: {
        description:
            "The process of exercising assessment objects (e.g., activities, mechanisms) under specified conditions to compare actual behavior with expected behavior.",
        example:
            "An assessor attempts to sign in with a disabled account to confirm that access is denied.",
    },
};

const MethodHeading = ({
    method,
    requirementId,
    children,
}: {
    method: Method;
    requirementId: string;
    children?: ReactNode;
}) => {
    const popoverId = `method-${method.toLowerCase()}-${requirementId}`;
    return (
        <div className="mb-2 flex items-center gap-2">
            <Badge variant="neutral" className="uppercase">
                {method}
            </Badge>
            <button
                type="button"
                popoverTarget={popoverId}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
                aria-label={`What does the ${method} method mean?`}
            >
                <IconInfo inline={false} />
            </button>
            <Popover id={popoverId}>
                <IconInfo />
                <span>
                    {METHOD_DESCRIPTIONS[method].description}
                    <span className="mt-2 block">
                        <span className="font-semibold">Example: </span>
                        {METHOD_DESCRIPTIONS[method].example}
                    </span>
                </span>
            </Popover>
            {children}
        </div>
    );
};

// Objective references like "[a]" or "[d,e,f]" point at individual assessment
// objectives. The form renders an anchor for each objective (e.g.
// id="03.01.01.a"), so turn the references into in-page links.
const OBJECTIVE_REF = /\[([a-o](?:\s*,\s*[a-o])*)\]/g;
const linkifyObjectives = (text: string, requirementId: string): string =>
    text.replace(OBJECTIVE_REF, (_match, letters: string) => {
        const links = letters
            .split(",")
            .map((letter) => letter.trim())
            .map(
                (letter) =>
                    `<a href="#${requirementId}.${letter}">${letter}</a>`,
            )
            .join(", ");
        return `[${links}]`;
    });

const Prose = ({
    text,
    requirementId,
}: {
    text: string;
    requirementId: string;
}) => (
    <p
        className="discussion text-sm leading-relaxed text-foreground"
        dangerouslySetInnerHTML={{
            __html: linkifyObjectives(text, requirementId),
        }}
    />
);

const Section = ({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) => (
    <section className="mt-6 first:mt-0">
        <Heading level={4} as="h4" className="mb-3">
            {title}
        </Heading>
        {children}
    </section>
);

const MethodList = ({
    method,
    requirementId,
    items,
}: {
    method: Method;
    requirementId: string;
    items: string[];
}) => {
    if (!items?.length) {
        return null;
    }
    return (
        <div className="min-w-[16rem] flex-1">
            <MethodHeading method={method} requirementId={requirementId} />
            <ul className="list-disc pl-5 text-sm leading-relaxed text-foreground">
                {items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                ))}
            </ul>
        </div>
    );
};

/**
 * The Examine method renders as a manual checklist: tick each evidence type
 * that has been collected for the requirement. State is persisted immediately
 * via {@link useExamineEvidence}.
 */
const ExamineList = ({
    requirementId,
    items,
    checked,
    onToggle,
}: {
    requirementId: string;
    items: string[];
    checked?: Set<string>;
    onToggle: (item: string) => void;
}) => {
    if (!items?.length) {
        return null;
    }
    return (
        <div className="min-w-[16rem] flex-1">
            <MethodHeading method="Examine" requirementId={requirementId} />
            <p className="mb-2 text-xs italic text-muted-foreground">
                Not all of the evidence listed is required to meet this
                requirement — check the items your organization has collected.
            </p>
            <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground">
                {items.map((item, idx) => {
                    const id = `examine-${requirementId}-${idx}`;
                    const isChecked = checked?.has(item) ?? false;
                    return (
                        <li key={idx} className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                id={id}
                                checked={isChecked}
                                onChange={() => onToggle(item)}
                                className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                            />
                            <label
                                htmlFor={id}
                                className={`cursor-pointer ${
                                    isChecked ? "" : "text-muted-foreground"
                                }`}
                            >
                                {item}
                            </label>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export const AssessmentGuidance = ({
    requirementId,
}: {
    requirementId: string;
}) => {
    const revision = useRevisionContext();
    const { checked, toggle } = useExamineEvidence(requirementId);

    // Guidance is published for Rev. 2 only.
    const guidance =
        revision === Revision.V2
            ? getAssessmentGuidance(requirementId)
            : undefined;

    if (!guidance) {
        return null;
    }

    const { furtherDiscussion, assessmentMethods, keyReferences } = guidance;
    const { overview, examples, considerations } = furtherDiscussion;
    const examineItems = assessmentMethods.examine;
    const examineCollected = examineItems.reduce(
        (count, item) => count + (checked?.has(item) ? 1 : 0),
        0,
    );

    return (
        <details className="mt-6 w-full rounded-lg border border-border bg-card text-card-foreground shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 font-semibold tracking-tight marker:content-none hover:bg-secondary">
                <IconInfo className="text-primary" />
                <span className="flex-1">Assessment Guidance</span>
                {!!examineItems.length && (
                    <Badge
                        variant={
                            examineCollected === examineItems.length
                                ? "success"
                                : "neutral"
                        }
                        className="font-normal normal-case"
                    >
                        Examine {examineCollected}/{examineItems.length}
                    </Badge>
                )}
                <svg
                    className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m6 9 6 6 6-6"
                    />
                </svg>
            </summary>

            <div className="border-t border-border px-4 py-4">
                <p className="mb-4 text-xs text-muted-foreground">
                    How an assessor determines this requirement is met. Source:{" "}
                    {assessmentGuideSource}.
                </p>

                {!!overview.length && (
                    <Section title="Discussion">
                        {overview.map((paragraph, idx) => (
                            <Prose
                                key={idx}
                                text={paragraph}
                                requirementId={requirementId}
                            />
                        ))}
                    </Section>
                )}

                {!!examples.length && (
                    <Section title="Examples">
                        <ol className="flex flex-col gap-3">
                            {examples.map((example, idx) => (
                                <li
                                    key={idx}
                                    className="rounded-md border border-border bg-secondary px-4 py-3"
                                >
                                    <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                                        Example {idx + 1}
                                    </span>
                                    <Prose
                                        text={example}
                                        requirementId={requirementId}
                                    />
                                </li>
                            ))}
                        </ol>
                    </Section>
                )}

                <Section title="Assessment Methods">
                    <div className="flex flex-wrap gap-6">
                        <ExamineList
                            requirementId={requirementId}
                            items={examineItems}
                            checked={checked}
                            onToggle={toggle}
                        />
                        <MethodList
                            method="Interview"
                            requirementId={requirementId}
                            items={assessmentMethods.interview}
                        />
                        <MethodList
                            method="Test"
                            requirementId={requirementId}
                            items={assessmentMethods.test}
                        />
                    </div>
                </Section>

                {!!considerations.length && (
                    <Section title="Potential Assessment Considerations">
                        <ul className="flex flex-col gap-2">
                            {considerations.map((consideration, idx) => (
                                <li
                                    key={idx}
                                    className="flex gap-2 text-sm leading-relaxed text-foreground"
                                >
                                    <span aria-hidden="true">•</span>
                                    <span
                                        className="discussion"
                                        dangerouslySetInnerHTML={{
                                            __html: linkifyObjectives(
                                                consideration,
                                                requirementId,
                                            ),
                                        }}
                                    />
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}

                {!!keyReferences.length && (
                    <Section title="Key References">
                        <div className="flex flex-wrap gap-2">
                            {keyReferences.map((reference) => (
                                <Badge key={reference} variant="info">
                                    {reference}
                                </Badge>
                            ))}
                        </div>
                    </Section>
                )}
            </div>
        </details>
    );
};
