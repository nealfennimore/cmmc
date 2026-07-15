"use client";
import {
    IconBlank,
    IconCheckmark,
    IconHammer,
    IconMinus,
    IconMinusLine,
    IconPause,
    IconPauseLine,
    IconQuestion,
    IconWarning,
} from "./icons";

interface StatusStateProps {
    statuses?: Status[];
    status?: Status;
    size?: string;
}

export enum Status {
    IMPLEMENTED = "implemented",
    NOT_IMPLEMENTED = "not-implemented",
    NOT_APPLICABLE = "not-applicable",
    PARTIALLY_IMPLEMENTED = "partially-implemented",
    NOT_STARTED = "not-started",
    NEEDS_WORK = "needs-work",
    _NOT_STARTED_DEFAULT = "", // Special default value for empty form fields
}

type ValueOf<T> = T[keyof T];
export const StatusIcon: Record<
    ValueOf<typeof Status>,
    typeof IconCheckmark
> = {
    [Status.IMPLEMENTED]: IconCheckmark,
    [Status.NOT_IMPLEMENTED]: IconMinus,
    [Status.NOT_APPLICABLE]: IconMinusLine,
    [Status.PARTIALLY_IMPLEMENTED]: IconPause,
    [Status.NEEDS_WORK]: IconHammer,
    [Status.NOT_STARTED]: IconBlank,
    [Status._NOT_STARTED_DEFAULT]: IconBlank,
};

const isNotStarted = (status: Status) =>
    status === Status._NOT_STARTED_DEFAULT || status === Status.NOT_STARTED;
const hasNotStarted = (statuses: Status[]) =>
    statuses.includes(Status.NOT_STARTED) ||
    statuses.includes(Status._NOT_STARTED_DEFAULT);

export const calcStatus = (statuses: Status[] | undefined) => {
    if (statuses?.length) {
        // When some work has been started on a requirement
        if (
            statuses.includes(Status.NEEDS_WORK) ||
            (hasNotStarted(statuses) && !statuses.every(isNotStarted))
        ) {
            return Status.NEEDS_WORK;
        }

        // When any implemented it's considered failed for the entire security requirement
        if (statuses.includes(Status.NOT_IMPLEMENTED)) {
            return Status.NOT_IMPLEMENTED;
        }

        // For all are N/A
        if (statuses.every((s) => s === Status.NOT_APPLICABLE)) {
            return Status.NOT_APPLICABLE;
        }

        if (
            statuses.every((s) =>
                // Cases that allow for points to be given
                [
                    Status.NOT_APPLICABLE,
                    Status.IMPLEMENTED,
                    Status.PARTIALLY_IMPLEMENTED,
                ].includes(s),
            )
        ) {
            // Partial should take precedence over implemented
            if (statuses.includes(Status.PARTIALLY_IMPLEMENTED)) {
                return Status.PARTIALLY_IMPLEMENTED;
            }
            return Status.IMPLEMENTED;
        }
    }

    return Status.NOT_STARTED;
};

// Static map so Tailwind can see the full class names (it purges `text-${size}`).
const sizeClasses: Record<string, string> = {
    xs: "text-xs",
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
    xl: "text-xl",
    "2xl": "text-2xl",
};
export const toSizeClass = (size = "xl") => sizeClasses[size] ?? "text-xl";

// SVG box sizes matching each font-size tier (text-xs = 0.75rem = h-3, and
// so on), so swapping an emoji glyph for an SVG icon keeps its footprint.
// text-lg (1.125rem) has no spacing-scale step in Tailwind 3, hence the
// arbitrary value.
const iconSizeClasses: Record<string, string> = {
    xs: "h-3 w-3",
    sm: "h-3.5 w-3.5",
    base: "h-4 w-4",
    lg: "h-[1.125rem] w-[1.125rem]",
    xl: "h-5 w-5",
    "2xl": "h-6 w-6",
};
export const toIconSizeClass = (size = "xl") =>
    iconSizeClasses[size] ?? "h-5 w-5";

const StatusSpan = ({
    status,
    size = "xl",
}: {
    status?: Status;
    size?: string;
}) => {
    const Icon = status
        ? StatusIcon?.[status]
        : StatusIcon[Status._NOT_STARTED_DEFAULT];

    switch (status) {
        case Status.IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-green-600 mr-2`}
                    title="Implemented"
                >
                    <Icon className={toIconSizeClass(size)} />
                </span>
            );
        case Status.NOT_IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-red-600 mr-2`}
                    title="Not implemented"
                >
                    <Icon className={toIconSizeClass(size)} />
                </span>
            );
        case Status.NOT_APPLICABLE:
            return (
                <span
                    className={`${toSizeClass(size)} text-black mr-2`}
                    title="Not applicable"
                >
                    <Icon className={toIconSizeClass(size)} />
                </span>
            );
        case Status.NEEDS_WORK:
            return (
                <span
                    className={`${toSizeClass(size)} text-amber-800 mr-2`}
                    title="Has work remaining"
                >
                    <Icon className={toIconSizeClass(size)} />
                </span>
            );
        case Status.PARTIALLY_IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-amber-700 mr-2`}
                    title="Partially implemented"
                >
                    <Icon className={toIconSizeClass(size)} />
                </span>
            );
        default:
            return null;
    }
};

export const StatusState = ({ statuses, status, size }: StatusStateProps) => {
    if (status) {
        return <StatusSpan status={status} size={size} />;
    }

    return <StatusSpan status={calcStatus(statuses)} size={size} />;
};
