// Shared upgrade surfaces for the free web tier (locked rows, locked detail
// pages, the Level 1 score tile). Only ever rendered in the web build, so
// plain anchors are fine — no Tauri openExternal fallback needed.

import type { ReactNode } from "react";
import { IconInfo } from "./icon_info";
import { Badge, buttonClasses } from "./ui";

export const MARKETING_URL =
    "https://getcmmc.consulting/download?utm_source=cmmc-app&utm_medium=upgrade";

export const IconLock = ({
    className = "h-4 mr-1",
}: {
    className?: string;
}) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={className}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 14v3m-3-6V7a3 3 0 1 1 6 0v4m-8 0h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1"
        />
    </svg>
);

/** Small marker on locked requirement/family rows in list views. */
export const LockedBadge = () => (
    <Badge variant="warning" className="shrink-0" title="">
        <IconLock /> Desktop
    </Badge>
);

/** Inline text link for popovers and small print. */
export const UpgradeLink = ({ children }: { children?: ReactNode }) => (
    <a
        href={MARKETING_URL}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2 hover:no-underline"
    >
        {children ?? "Get the desktop app"}
    </a>
);

/** Alert card at the top of locked requirement detail pages. */
export const UpgradeBanner = () => (
    <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
        role="alert"
    >
        <div className="flex items-center gap-1">
            <IconInfo />
            <span className="sr-only">Info</span>
            <h4 className="text-lg font-semibold text-amber-900">
                Beyond CMMC Level 1
            </h4>
        </div>
        <div className="mt-2 flex flex-col gap-2 text-sm text-amber-800">
            <p>
                The free web app covers the 17 CMMC Level 1 practices. This
                requirement is part of the full NIST 800-171 set — get the
                desktop app to work on all 110 requirements with SPRS scoring.
                Previously saved data is shown read-only below, and your data
                always remains exportable in full.
            </p>
            <a
                href={MARKETING_URL}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({
                    size: "sm",
                    className: "self-start",
                })}
            >
                Get the desktop app
            </a>
        </div>
    </div>
);
