"use client";
import {
    SecurityRequirementValue,
    SecurityRequirementValuesSchema,
} from "@/api/entities/RequirementValues";
import {
    Revision,
    toNum,
    toPath,
    useRevisionContext,
} from "@/app/context/revision";
import { useRequirementsValues } from "@/app/hooks/requirementValues";
import Link from "next/link";
import { useParams } from "next/navigation";

function getNextPath({
    nextRevision,
    family_id,
    requirement_id,
    values,
}: {
    nextRevision: Revision;
    family_id?: string;
    requirement_id?: string;
    values: SecurityRequirementValuesSchema;
}) {
    const value: SecurityRequirementValue | undefined =
        values?.[requirement_id || ""];
    const hasRequirement = !!(requirement_id && value);
    const nextFamily: SecurityRequirementValue | undefined =
        values?.[`${family_id}.01`] ||
        values?.[`${requirement_id?.slice(0, 5)}.01`];

    let nextPath = toPath(nextRevision);
    if (hasRequirement) {
        if (value.revision.includes(toNum(nextRevision))) {
            nextPath = `${nextPath}/requirement/${requirement_id}`;
        } else if (
            nextFamily &&
            nextFamily?.revision?.includes(toNum(nextRevision))
        ) {
            nextPath = `${nextPath}/family/${requirement_id.slice(0, 5)}`;
        }
    } else if (
        nextFamily &&
        nextFamily?.revision?.includes(toNum(nextRevision))
    ) {
        nextPath = `${nextPath}/family/${family_id}`;
    }

    return nextPath;
}

export const RevisionSwitch = () => {
    const revision = useRevisionContext();
    const { family_id, requirement_id } = useParams<{
        family_id?: string;
        requirement_id?: string;
    }>();
    const values = useRequirementsValues();

    const nextRevision = revision === Revision.V2 ? Revision.V3 : Revision.V2;

    const nextPath = getNextPath({
        nextRevision,
        family_id,
        requirement_id,
        values,
    });
    return (
        <div className="relative inline-block text-left" data-tour="revision-switch">
            <Link
                href={nextPath}
                title={`Toggle 800-171 revision to ${
                    nextRevision
                }. CMMC currently only uses R2.`}
                className={`me-2 inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    revision === Revision.V2
                        ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                        : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
            >
                {revision}
            </Link>
        </div>
    );
};
