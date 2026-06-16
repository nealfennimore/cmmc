"use client";

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

const StatusSpan = ({
    status,
    size = "xl",
}: {
    status?: Status;
    size?: string;
}) => {
    switch (status) {
        case Status.IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-green-600 mx-2`}
                    title="Implemented"
                >
                    🟢
                </span>
            );
        case Status.NOT_IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-red-600 mx-2`}
                    title="Not implemented"
                >
                    🔴
                </span>
            );
        case Status.NOT_APPLICABLE:
            return (
                <span
                    className={`${toSizeClass(size)} text-black mx-2`}
                    title="Not applicable"
                >
                    ⚫
                </span>
            );
        case Status.NEEDS_WORK:
            return (
                <span
                    className={`${toSizeClass(size)} text-black mx-2`}
                    title="Has work remaining"
                >
                    🚧
                </span>
            );
        case Status.PARTIALLY_IMPLEMENTED:
            return (
                <span
                    className={`${toSizeClass(size)} text-black mx-2`}
                    title="Partially implemented"
                >
                    🟡
                </span>
            );
        default:
            return (
                <span
                    className={`${toSizeClass(size)} text-muted-foreground mx-2`}
                    title="Not started"
                >
                    ⚪
                </span>
            );
    }
};

export const StatusState = ({ statuses, status, size }: StatusStateProps) => {
    if (status) {
        return <StatusSpan status={status} size={size} />;
    }

    return <StatusSpan status={calcStatus(statuses)} size={size} />;
};
