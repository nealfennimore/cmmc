"use client";
import {
    OdpEntry,
    getStatementSegments,
    odpFootnotes,
    odpSource,
} from "@/api/entities/OrganizationDefinedParameters";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { Badge } from "./ui";

/**
 * A statement placeholder filled with its DoD value. The value is highlighted
 * and hovering (or focusing) it reveals the ODP details. For the four ODPs
 * the memo defines as guidance rather than a value, the original placeholder
 * stays in the sentence and the hover carries the guidance text.
 */
const OdpFill = ({
    placeholder,
    entry,
}: {
    placeholder: string;
    entry: OdpEntry;
}) => (
    <span className="group relative" tabIndex={0}>
        <span
            className={`cursor-help whitespace-pre-line rounded px-1 underline decoration-dotted underline-offset-4 ${
                entry.guidance
                    ? "bg-amber-50 text-amber-700"
                    : "bg-accent text-accent-foreground"
            }`}
        >
            {entry.guidance ? placeholder : entry.value}
        </span>
        <span className="absolute left-0 top-full z-20 hidden w-max max-w-xs pt-1 group-focus-within:block group-hover:block sm:max-w-md">
            <span className="block rounded-md border border-border bg-card p-3 text-sm font-normal normal-case text-card-foreground shadow-lg">
                <span className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="info" className="uppercase">
                        DoD ODP
                    </Badge>
                    <span className="text-xs font-semibold text-muted-foreground">
                        {entry.id}
                    </span>
                    {entry.guidance && (
                        <Badge variant="warning" className="uppercase">
                            Guidance
                        </Badge>
                    )}
                </span>
                {entry.guidance ? (
                    <span className="block whitespace-pre-line text-xs leading-relaxed">
                        The DoD defines guidance rather than a specified value
                        for this parameter: {entry.value}
                    </span>
                ) : (
                    <span className="block text-xs italic text-muted-foreground">
                        Fills: {placeholder}
                    </span>
                )}
                {entry.footnotes?.map((key) => (
                    <span
                        key={key}
                        className="mt-1 block text-xs italic text-muted-foreground"
                    >
                        {odpFootnotes[key]}
                    </span>
                ))}
                <span className="mt-1 block text-xs text-muted-foreground">
                    Source:{" "}
                    <a
                        href={odpSource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        {odpSource.title}
                    </a>{" "}
                    ({odpSource.signed}).
                </span>
            </span>
        </span>
    </span>
);

/**
 * Requirement statement text with each `[Assignment: ...]`/`[Selection: ...]`
 * placeholder filled in with the DoD-defined parameter value. Falls back to
 * the plain text for rev 2 and for statements without DoD values.
 */
export const StatementText = ({
    text,
    statementId,
}: {
    text: string;
    statementId: string;
}) => {
    const revision = useRevisionContext();

    // The DoD memo defines ODP values for rev 3 only.
    const segments =
        revision === Revision.V3
            ? getStatementSegments(statementId)
            : undefined;

    if (!segments) {
        return <>{text}</>;
    }

    return (
        <>
            {segments.map((segment, idx) =>
                segment.entry ? (
                    <OdpFill
                        key={segment.entry.id}
                        placeholder={segment.text}
                        entry={segment.entry}
                    />
                ) : (
                    <span key={idx}>{segment.text}</span>
                ),
            )}
        </>
    );
};
