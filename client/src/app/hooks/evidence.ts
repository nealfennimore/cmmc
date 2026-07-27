"use client";
import { useManifestContext } from "@/app/context/manifest";
import { useMemo } from "react";
import { useDBEvidenceRequirements } from "./db";

export class FamilyEvidence {
    requirementsEvidence: Record<string, boolean>;

    constructor(requirementsEvidence?: Record<string, boolean>) {
        this.requirementsEvidence = requirementsEvidence || {};
    }

    get hasEvidence() {
        return Object.values(this.requirementsEvidence).every((b) => b);
    }

    setRequirementEvidence(requirementId: string, valid: boolean) {
        this.requirementsEvidence[requirementId] = valid;
    }

    requirementEvidence(requirementId: string) {
        return this.requirementsEvidence[requirementId] || false;
    }
}

type GlobalEvidence = Record<string, FamilyEvidence>;

export const useGlobalEvidence = () => {
    const manifest = useManifestContext();
    const families = manifest?.families?.elements;
    const requirementsById = manifest.requirements.byRequirements;
    const idbEvidenceRequirements = useDBEvidenceRequirements();

    return useMemo(() => {
        if (!families?.length || !idbEvidenceRequirements) {
            return;
        }

        const familiesEvidence = families.reduce((acc, family) => {
            acc[family.element_identifier] = new FamilyEvidence();
            return acc;
        }, {} as GlobalEvidence);

        const evidenceByRequirementId = idbEvidenceRequirements?.reduce(
            (acc, cur) => {
                acc[cur.requirement_id] = true;
                return acc;
            },
            {} as Record<string, boolean>,
        );

        for (const [requirementId, requirement] of Object.entries(
            requirementsById,
        )) {
            const family = requirement[0].family;
            const familyEvidence = familiesEvidence[family];
            familyEvidence.setRequirementEvidence(
                requirementId,
                !!evidenceByRequirementId?.[requirementId],
            );
        }
        return familiesEvidence;
    }, [families, requirementsById, idbEvidenceRequirements]);
};

/**
 * Count of linked evidence artifacts per requirement id. Requirement ids
 * share one key space across revisions, so no revision filtering is needed —
 * the manifest drives which ids render.
 */
export const useEvidenceCounts = (): Record<string, number> | undefined => {
    const idbEvidenceRequirements = useDBEvidenceRequirements();
    return useMemo(
        () =>
            idbEvidenceRequirements?.reduce(
                (acc, { requirement_id }) => {
                    acc[requirement_id] = (acc[requirement_id] ?? 0) + 1;
                    return acc;
                },
                {} as Record<string, number>,
            ),
        [idbEvidenceRequirements],
    );
};

export const useFamilyEvidence = (familyId: string) => {
    const globalStatus = useGlobalEvidence();
    return globalStatus?.[familyId];
};
