"use client";

interface StatusStateProps {
    statuses?: Status[];
    status?: Status;
    size?: string;
}

const IconCheckmark = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8.5 11.5 11 14l4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0"
        />
    </svg>
);

const IconWarning = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"
        />
    </svg>
);
const IconPause = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 9v6m4-6v6m7-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0"
        />
    </svg>
);
const IconPauseLine = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        className={`${className}`}
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        fill="none"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 6H8a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Zm7 0h-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"
        />
    </svg>
);
const IconMinus = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M7.757 12h8.486M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"
        />
    </svg>
);
const IconHammer = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
            d="m20.9532 11.7634-2.0523-2.05225-2.0523 2.05225 2.0523 2.0523zm-1.3681-2.73651-4.1046-4.10457L12.06 8.3428l4.1046 4.1046zm-4.1047 2.73651-2.7363-2.73638-8.20919 8.20918 2.73639 2.7364z"
        />
        <path
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
            d="m12.9306 3.74083 1.8658 1.86571-2.0523 2.05229-1.5548-1.55476c-.995-.99505-3.23389-.49753-3.91799.18657l2.73639-2.73639c.6841-.68409 1.9901-.74628 2.9229.18658Z"
        />
    </svg>
);
const IconMinusLine = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 12h14"
        />
    </svg>
);
const IconQuestion = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9.529 9.988a2.502 2.502 0 1 1 5 .191A2.441 2.441 0 0 1 12 12.582V14m-.01 3.008H12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"
        />
    </svg>
);
const IconBlank = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={`${className}`}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        />
    </svg>
);

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
