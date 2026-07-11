"use client";
import { useManifestContext } from "@/app/context/manifest";
import { toNum, toPath, useRevisionContext } from "@/app/context/revision";
import { isFreeTier, isUnlocked } from "@/app/utils/tier";
import Link from "next/link";
import { useGlobalEvidence } from "../hooks/evidence";
import { useGlobalStatus } from "../hooks/status";
import { Breadcrumbs } from "./breadcrumbs";
import { EvidenceState } from "./evidence";
import { IconInfo } from "./icon_info";
import { Popover } from "./popover";
import { StatusState } from "./status";
import { Heading } from "./ui";
import { LockedBadge } from "./upgrade_cta";

export const Families = () => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const manifest = useManifestContext();
    const families = manifest?.families?.elements;
    const globalStatus = useGlobalStatus();
    const globalEvidence = useGlobalEvidence();
    if (!families?.length) {
        return null;
    }

    return (
        <>
            <Breadcrumbs />
            <Heading level={2} className="flex flex-wrap items-center gap-2">
                SP NIST 800-171 Families {revision}
                <button
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    popoverTarget="families-popover"
                    aria-label="About families"
                >
                    <IconInfo inline={false} />
                </button>
            </Heading>
            <Popover id="families-popover">
                <IconInfo />
                <span>
                    Families from NIST 800-171 {revision} include controls from
                    revision {toNum(revision)}. Revision 2 is the current valid
                    CMMC revision.
                </span>
            </Popover>
            <ul className="flex w-full flex-col gap-3" data-tour="families">
                {families.map((family) => (
                    <li key={family.element_identifier}>
                        <Link
                            className="flex items-center rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary hover:bg-secondary"
                            href={`${path}/family/${family.element_identifier}`}
                        >
                            <StatusState
                                status={
                                    globalStatus?.[family.element_identifier]
                                        ?.status
                                }
                            />
                            <span className="text-lg font-medium">
                                <span className="text-muted-foreground">
                                    {family.element_identifier}:
                                </span>{" "}
                                {family.title}
                            </span>
                            {isFreeTier() &&
                                !manifest.requirements.byFamily[
                                    family.element_identifier
                                ]?.some((requirement) =>
                                    isUnlocked(requirement.element_identifier),
                                ) && (
                                    <span className="ms-2">
                                        <LockedBadge />
                                    </span>
                                )}
                            <EvidenceState
                                evidence={
                                    globalEvidence?.[family.element_identifier]
                                        ?.hasEvidence
                                }
                            />
                        </Link>
                    </li>
                ))}
            </ul>
        </>
    );
};
