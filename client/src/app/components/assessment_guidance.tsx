"use client";
import {
    assessmentGuideSource,
    getAssessmentGuidance,
} from "@/api/entities/AssessmentGuide";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { ReactNode } from "react";
import { IconInfo } from "./icon_info";
import { Badge, Heading } from "./ui";

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

const MethodList = ({ title, items }: { title: string; items: string[] }) => {
    if (!items?.length) {
        return null;
    }
    return (
        <div className="min-w-[16rem] flex-1">
            <Badge variant="neutral" className="mb-2 uppercase">
                {title}
            </Badge>
            <ul className="list-disc pl-5 text-sm leading-relaxed text-foreground">
                {items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                ))}
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

    // Guidance is published for Rev. 2 only.
    if (revision !== Revision.V2) {
        return null;
    }

    const guidance = getAssessmentGuidance(requirementId);
    if (!guidance) {
        return null;
    }

    const { furtherDiscussion, assessmentMethods, keyReferences } = guidance;
    const { overview, examples, considerations } = furtherDiscussion;

    return (
        <details className="mt-6 w-full rounded-lg border border-border bg-card text-card-foreground shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 font-semibold tracking-tight marker:content-none hover:bg-secondary">
                <IconInfo className="text-primary" />
                <span className="flex-1">Assessment Guidance</span>
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
                        <MethodList
                            title="Examine"
                            items={assessmentMethods.examine}
                        />
                        <MethodList
                            title="Interview"
                            items={assessmentMethods.interview}
                        />
                        <MethodList
                            title="Test"
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
