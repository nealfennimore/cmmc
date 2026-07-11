"use client";
import { ElementWrapper } from "@/api/entities/Framework";
import { useManifestContext } from "@/app/context/manifest";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { isLockedRequirement } from "@/app/utils/tier";
import { IDB } from "@/app/db";
import { marked } from "marked";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useFamilyEvidence } from "../../hooks/evidence";
import { useRequirementValue } from "../../hooks/requirementValues";
import { Status } from "../status";
import { SecurityRequirement } from "./security_requirement";
import { WithdrawnSecurityRequirement } from "./withdrawn";

// Set options
marked.use({
    async: true,
    pedantic: false,
    gfm: true,
    breaks: true,
});

export const SecurityRequirements = ({
    requirementId,
}: {
    requirementId: string;
}) => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const [initialState, setInitialState] = useState({});
    const [isHydrating, setHydrating] = useState(false);
    const [statuses, setStatuses] = useState<Status[]>([]);
    const manifest = useManifestContext();
    const router = useRouter();
    const value = useRequirementValue(requirementId);
    const evidence = useFamilyEvidence(
        requirementId.slice(0, 5),
    )?.requirementEvidence(requirementId);

    const withdrawn = manifest.withdrawReason.byRequirements[requirementId];
    // Free web tier: requirements beyond CMMC Level 1 render read-only.
    const locked = isLockedRequirement(requirementId);

    const securityRequirements = useMemo(() => {
        return (
            manifest?.securityRequirements.byRequirements[requirementId] || []
        );
    }, [manifest, requirementId]);
    const requirement = useMemo(() => {
        return manifest?.requirements.byId[requirementId] || null;
    }, [manifest, requirementId]);

    const groupings = useMemo(() => {
        const groupings: Record<string, ElementWrapper[]> = {};
        for (const securityRequirement of securityRequirements) {
            if (!securityRequirement.text) {
                continue;
            }
            if (!groupings[securityRequirement.subRequirement]) {
                groupings[securityRequirement.subRequirement] = [];
            }
            groupings[securityRequirement.subRequirement].push(
                securityRequirement,
            );
        }
        return groupings;
    }, [securityRequirements]);

    const [prev, next] = useMemo(() => {
        const requirements =
            manifest?.requirements.byFamily[requirement?.family] || [];
        const requirementIdx = requirements.findIndex(
            (r) => r.id === requirementId,
        );

        let prev = requirements[requirementIdx - 1];
        let next = requirements[requirementIdx + 1];

        if (!prev || !next) {
            const families = manifest.families.elements;
            const familyIdx = families.findIndex(
                (f) => f.id === requirement.family,
            );
            if (!prev) {
                const prevFamilyId = families?.[familyIdx - 1]?.id;
                const prevRequirements =
                    manifest.requirements.byFamily[prevFamilyId];
                prev = prevRequirements?.[prevRequirements?.length - 1];
            }
            if (!next) {
                const nextFamilyId = families?.[familyIdx + 1]?.id;
                next = manifest.requirements.byFamily[nextFamilyId]?.[0];
            }
        }
        return [prev, next];
    }, [requirement, requirementId, manifest]);

    useEffect(() => {
        async function fetchInitialState() {
            setHydrating(true);
            const ids = securityRequirements.map((s) => s.subSubRequirement);
            const idbSecurityRequirements =
                await IDB.securityRequirements.getAll(
                    IDBKeyRange.bound(ids[0], ids[ids.length - 1]),
                );
            const nextStatuses: Status[] = [];
            const state = idbSecurityRequirements?.reduce(
                (acc, requirement) => {
                    if (ids.includes(requirement.id)) {
                        acc[`${requirement.id}.status`] = requirement.status;
                        acc[`${requirement.id}.description`] =
                            requirement.description;
                        nextStatuses.push(requirement.status as Status);
                    }
                    return acc;
                },
                {},
            );
            setStatuses(nextStatuses);
            setInitialState(state);
            setHydrating(false);
        }
        fetchInitialState();
    }, [
        requirementId,
        setInitialState,
        securityRequirements,
        setStatuses,
        setHydrating,
    ]);

    useEffect(() => {
        const handleHashChange = (event) => {
            const url = new URL(
                `${window.location.origin}/${event.newURL.split("#")[1]}`,
            );
            if (url.searchParams.get("element")) {
                // HACK: Allows for the back button to work properly
                history.replaceState(
                    null,
                    "",
                    window.location.pathname + window.location.search,
                );
                router.push(
                    `${path}/requirement/${url.searchParams.get("element")}`,
                );
            }
        };

        window.addEventListener("hashchange", handleHashChange);

        const saveOnCtrlS = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.key === "s") {
                event.preventDefault();
                const form = document.forms?.[0];
                form?.requestSubmit();
            }
        };

        if (!locked) {
            document.addEventListener("keydown", saveOnCtrlS);
        }

        return () => {
            window.removeEventListener("hashchange", handleHashChange);
            document.removeEventListener("keydown", saveOnCtrlS);
        };
    }, [router, locked]);

    if (withdrawn) {
        return (
            <WithdrawnSecurityRequirement
                groupings={groupings}
                initialState={initialState}
                isHydrating={isHydrating}
                manifest={manifest}
                next={next}
                prev={prev}
                requirement={requirement}
                requirementId={requirementId}
                setInitialState={setInitialState}
                setStatuses={setStatuses}
                statuses={statuses}
                value={value}
                withdrawn={withdrawn}
                evidence={evidence}
                locked={locked}
            />
        );
    }
    if (!securityRequirements?.length) {
        return null;
    }

    return (
        <SecurityRequirement
            groupings={groupings}
            initialState={initialState}
            isHydrating={isHydrating}
            manifest={manifest}
            next={next}
            prev={prev}
            requirement={requirement}
            requirementId={requirementId}
            setInitialState={setInitialState}
            setStatuses={setStatuses}
            statuses={statuses}
            value={value}
            evidence={evidence}
            locked={locked}
        />
    );
};
