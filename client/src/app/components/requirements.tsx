"use client";
import { useManifestContext } from "@/app/context/manifest";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { isLockedRequirement } from "@/app/utils/tier";
import Link from "next/link";
import { useMemo } from "react";
import { useFamilyEvidence } from "../hooks/evidence";
import { useFamilyStatus } from "../hooks/status";
import { Breadcrumbs } from "./breadcrumbs";
import { ContentNavigation } from "./content_navigation";
import { EvidenceState } from "./evidence";
import { IconInfo } from "./icons";
import { Popover } from "./popover";
import { StatusState } from "./status";
import { Heading } from "./ui";
import { LockedBadge } from "./upgrade_cta";

export const Requirements = ({ familyId }: { familyId: string }) => {
    const manifest = useManifestContext();
    const revision = useRevisionContext();
    const path = toPath(revision);
    const requirements = manifest.requirements.byFamily[familyId];
    const family = manifest.families.byId[familyId];
    const familyStatus = useFamilyStatus(familyId);
    const familyEvidence = useFamilyEvidence(familyId);

    const [prev, next] = useMemo(() => {
        const families = manifest?.families?.elements;
        const familyIdx = families?.findIndex((r) => r.id === familyId);
        const prev = families[familyIdx - 1];
        const next = families[familyIdx + 1];
        return [prev, next];
    }, [familyId, manifest]);

    return (
        <>
            <Breadcrumbs familyId={familyId} />
            <Heading level={2} className="flex flex-wrap items-center gap-2">
                Requirements for {family.element_identifier}: {family.title}{" "}
                <button
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    popoverTarget="requirements-popover"
                    aria-label="About requirements"
                >
                    <IconInfo inline={false} />
                </button>
                <StatusState status={familyStatus?.status} />
                <EvidenceState evidence={familyEvidence?.hasEvidence} />
            </Heading>
            <Popover id="requirements-popover">
                <IconInfo />
                <span>Requirements from NIST 800-171 {revision}</span>
            </Popover>
            <ContentNavigation
                elementIdentity={(element) => element?.family}
                previous={prev}
                next={next}
                elementType="family"
            />
            <ol className="flex w-full flex-col gap-3">
                {requirements?.map((requirement) => {
                    const withdrawn =
                        manifest.withdrawReason.byRequirements[requirement.id];
                    const className = withdrawn ? "line-through" : "";
                    return (
                        <li key={requirement.element_identifier}>
                            <Link
                                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary hover:bg-secondary"
                                href={`${path}/requirement/${requirement.element_identifier}`}
                            >
                                <span
                                    className={`text-lg font-medium ${className}`}
                                >
                                    <span className="text-muted-foreground">
                                        {requirement.element_identifier}:
                                    </span>{" "}
                                    {requirement.title}
                                </span>
                                <span className="flex">
                                    {isLockedRequirement(
                                        requirement.element_identifier,
                                    ) && (
                                        <span className="mr-2">
                                            <LockedBadge />
                                        </span>
                                    )}
                                    <StatusState
                                        status={familyStatus?.requirementStatus(
                                            requirement.element_identifier,
                                        )}
                                    />
                                    <EvidenceState
                                        evidence={familyEvidence?.requirementEvidence(
                                            requirement.element_identifier,
                                        )}
                                    />
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </>
    );
};
