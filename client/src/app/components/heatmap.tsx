"use client";
import { useManifestContext } from "@/app/context/manifest";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { isFreeTier, isLockedRequirement } from "@/app/utils/tier";
import Link from "next/link";
import { useEvidenceCounts } from "../hooks/evidence";
import { useGlobalStatus } from "../hooks/status";
import { Breadcrumbs } from "./breadcrumbs";
import { IconInfo, IconLock } from "./icons";
import { Popover } from "./popover";
import { Status, StatusCellClasses, StatusLabel } from "./status";
import { Heading, menuItemClasses } from "./ui";
import { UpgradeLink } from "./upgrade_cta";

const LEGEND: Status[] = [
    Status.NOT_STARTED,
    Status.PARTIALLY_IMPLEMENTED,
    Status.IMPLEMENTED,
    Status.NEEDS_WORK,
    Status.NOT_IMPLEMENTED,
    Status.NOT_APPLICABLE,
];

const EvidenceCountBadge = ({ count }: { count: number }) => {
    if (!count) {
        return null;
    }
    return (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] leading-none text-white">
            {count > 9 ? "9+" : count}
        </span>
    );
};

const cellClasses =
    "relative flex h-9 w-9 items-center justify-center rounded-md text-xs font-medium";

const Legend = () => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {LEGEND.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
                <span
                    className={`h-3 w-3 rounded-sm ${StatusCellClasses[status]}`}
                />
                {StatusLabel[status]}
            </span>
        ))}
        <span className="flex items-center gap-1.5">
            <span className="relative h-3 w-3 rounded-sm border border-border bg-secondary">
                <EvidenceCountBadge count={2} />
            </span>
            Evidence files
        </span>
    </div>
);

export const Heatmap = () => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const manifest = useManifestContext();
    const families = manifest?.families?.elements;
    const globalStatus = useGlobalStatus();
    const evidenceCounts = useEvidenceCounts();
    if (!families?.length) {
        return null;
    }

    return (
        <>
            <Breadcrumbs />
            <Heading level={2} className="flex flex-wrap items-center gap-2">
                Evidence Heatmap {revision}
                <button
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    popoverTarget="heatmap-popover"
                    aria-label="About the evidence heatmap"
                >
                    <IconInfo inline={false} />
                </button>
            </Heading>
            <Popover id="heatmap-popover">
                <IconInfo />
                <span>
                    One cell per requirement, colored by implementation status,
                    with the number of attached evidence files in the corner.
                    Evidence presence shows coverage, not assessment readiness
                    — a control can be evidenced and still fall short of its
                    assessment objectives.
                </span>
            </Popover>
            {isFreeTier() && (
                <p className="text-sm text-muted-foreground">
                    The free web app covers the 17 CMMC Level 1 practices —{" "}
                    <UpgradeLink /> to work on all 110 requirements.
                </p>
            )}
            <Legend />
            <ul className="flex w-full flex-col gap-3">
                {families.map((family) => {
                    const requirements =
                        manifest.requirements.byFamily[
                            family.element_identifier
                        ]?.filter(
                            (requirement) =>
                                // Withdrawn controls can't be assessed and
                                // would render as permanent gray cells.
                                !manifest.withdrawReason.byRequirements[
                                    requirement.id
                                ],
                        ) ?? [];
                    if (!requirements.length) {
                        return null;
                    }
                    const familyStatus =
                        globalStatus?.[family.element_identifier];
                    return (
                        <li
                            key={family.element_identifier}
                            className="grid grid-cols-[6rem_1fr] items-start gap-3"
                        >
                            <Link
                                className="flex items-center gap-1 pt-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                                href={`${path}/family/${family.element_identifier}`}
                                title={family.title}
                            >
                                {family.element_identifier}
                            </Link>
                            <ul className="flex flex-wrap gap-2">
                                {requirements.map((requirement) => {
                                    const id = requirement.element_identifier;
                                    if (isLockedRequirement(id)) {
                                        return (
                                            <li key={id}>
                                                <span
                                                    className={`${cellClasses} border border-dashed border-border bg-secondary/50 text-muted-foreground`}
                                                    title={`${id}: available in the desktop app`}
                                                >
                                                    <IconLock className="h-4" />
                                                </span>
                                            </li>
                                        );
                                    }
                                    const status =
                                        familyStatus?.requirementStatus(id) ??
                                        Status.NOT_STARTED;
                                    return (
                                        <li key={id}>
                                            <Link
                                                href={`${path}/requirement/${id}`}
                                                title={`${id}: ${requirement.title} — ${StatusLabel[status]}, ${evidenceCounts?.[id] ?? 0} evidence file(s)`}
                                                className={`${cellClasses} transition-transform hover:scale-110 hover:ring-2 hover:ring-primary ${StatusCellClasses[status]}`}
                                            >
                                                {id.slice(-2)}
                                                <EvidenceCountBadge
                                                    count={
                                                        evidenceCounts?.[id] ??
                                                        0
                                                    }
                                                />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    );
                })}
            </ul>
        </>
    );
};

export const ViewHeatmap = ({ path }: { path: string }) => (
    <Link href={`${path}/heatmap`} className={menuItemClasses()} tabIndex={-1}>
        <span>Heatmap</span>
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            aria-hidden="true"
            className="h-4"
            viewBox="0 0 24 24"
        >
            <path
                stroke="currentColor"
                strokeWidth="2"
                d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
            />
        </svg>
    </Link>
);
