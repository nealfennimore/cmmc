"use client";

import { useNotification } from "@/app/context/notification";
import {
    IconCheck,
    IconWarning as IconWarningGlyph,
    IconX,
} from "./icons";
import { useRef } from "react";

interface ToastProps {
    text: string;
    identifier: string;
    warning?: boolean;
    danger?: boolean;
    permanent?: boolean;
    onClick: CallableFunction;
}

const CloseIcon = ({ onClick }: { onClick: CallableFunction }) => (
    <button
        type="button"
        className="ms-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClick}
        aria-label="Close"
    >
        <span className="sr-only">Close</span>
        <svg
            className="w-5 h-5"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18 17.94 6M18 18 6.06 6"
            />
        </svg>
    </button>
);

const IconDanger = () => (
    <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-600">
        <IconX />
        <span className="sr-only">Error icon</span>
    </div>
);
const IconWarning = () => (
    <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600">
        <IconWarningGlyph className="w-5 h-5" />
        <span className="sr-only">Warning icon</span>
    </div>
);

const IconSuccess = () => (
    <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-600">
        <IconCheck />
        <span className="sr-only">Check icon</span>
    </div>
);

export const Toast = ({
    text,
    identifier,
    danger,
    warning,
    onClick,
}: ToastProps) => {
    const node = useRef<HTMLDivElement>(null);

    let icon = <IconSuccess />;
    if (danger) {
        icon = <IconDanger />;
    } else if (warning) {
        icon = <IconWarning />;
    }

    return (
        <div
            id={identifier}
            className="mb-2 flex w-full max-w-sm items-center rounded-lg border border-border bg-card p-4 text-card-foreground shadow-md"
            role="alert"
            ref={node}
        >
            {icon}
            <div className="ms-3 text-sm font-normal">{text}</div>
            <CloseIcon onClick={() => onClick(identifier)} />
        </div>
    );
};

export const ToastContainer = () => {
    const { notificationsList, removeNotification } = useNotification();

    return (
        <aside className="fixed end-5 top-20 z-20 flex w-full max-w-xs flex-col items-center p-4">
            {notificationsList.map((notification) => {
                return (
                    <Toast
                        key={notification.id}
                        identifier={notification.id as string}
                        text={notification.text}
                        danger={notification.danger}
                        warning={notification.warning}
                        permanent={notification.permanent}
                        onClick={removeNotification}
                    />
                );
            })}
        </aside>
    );
};
