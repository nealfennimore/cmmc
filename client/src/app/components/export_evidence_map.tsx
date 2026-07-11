"use client";
import { useManifestContext } from "@/app/context/manifest";
import { Revision, toNum, useRevisionContext } from "@/app/context/revision";
import { IDB, IDBEvidenceV2 } from "@/app/db";
import { hashType, HashType, saveBlob, toFSName } from "@/app/utils/file";
import { isUnlocked } from "@/app/utils/tier";
import { useActionState } from "react";
import { confirm } from "./confirm";
import { menuItemClasses } from "./ui";

interface ArtifactMapping extends Omit<IDBEvidenceV2, "data" | "filename"> {
    url?: string;
    requirements: string[];
    hashType: HashType;
}

interface EvidenceMapping {
    artifacts: Record<string, ArtifactMapping>;
    byRequirements: Record<string, string[]>;
}

const download = async (mapping: EvidenceMapping, revision: Revision) => {
    const data = JSON.stringify(mapping, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const timestamp = Math.floor(new Date().getTime() / 1000);
    await saveBlob(
        `cmmc-800-171-rev-${toNum(revision)}-evidence-map-${timestamp}.json`,
        blob,
    );
};

export const ExportEvidenceMap = () => {
    const manifest = useManifestContext();
    const revision = useRevisionContext();
    const onClick = async () => {
        if (
            await confirm({
                title: "Download evidence map",
                message:
                    "This will download a JSON file mapping evidence to requirements.",
                confirmLabel: "Download",
            })
        ) {
            const requirements = manifest.requirements.byId;
            const evidence = await IDB.evidence.getAll();
            const evidenceRequirements =
                await IDB.evidenceRequirements.getAll();

            const evidenceRequirementsMapping = evidenceRequirements.reduce(
                (acc, evidenceRequirement) => {
                    if (!requirements[evidenceRequirement.requirement_id]) {
                        return acc;
                    }
                    // Free tier: the map covers only unlocked requirements.
                    if (!isUnlocked(evidenceRequirement.requirement_id)) {
                        return acc;
                    }

                    if (acc[evidenceRequirement.evidence_id]) {
                        acc[evidenceRequirement.evidence_id].push(
                            evidenceRequirement.requirement_id,
                        );
                    } else {
                        acc[evidenceRequirement.evidence_id] = [
                            evidenceRequirement.requirement_id,
                        ];
                    }
                    return acc;
                },
                {} as Record<string, string[]>,
            );

            const requirementsMapping = evidenceRequirements.reduce(
                (acc, evidenceRequirement) => {
                    if (!requirements[evidenceRequirement.requirement_id]) {
                        return acc;
                    }
                    // Free tier: the map covers only unlocked requirements.
                    if (!isUnlocked(evidenceRequirement.requirement_id)) {
                        return acc;
                    }

                    if (acc[evidenceRequirement.requirement_id]) {
                        acc[evidenceRequirement.requirement_id].push(
                            evidenceRequirement.evidence_id,
                        );
                    } else {
                        acc[evidenceRequirement.requirement_id] = [
                            evidenceRequirement.evidence_id,
                        ];
                    }
                    return acc;
                },
                {} as Record<string, string[]>,
            );

            const artifactMapping = evidence.reduce(
                (acc, artifact) => {
                    if (evidenceRequirementsMapping[artifact.id]) {
                        const item = {
                            id: artifact.id,
                            name: artifact.filename,
                            filename: toFSName(artifact),
                            type: artifact.type,
                            requirements:
                                evidenceRequirementsMapping[artifact.id],
                            hashType: hashType(artifact.id),
                        } as ArtifactMapping;
                        if (artifact.type === "url") {
                            item.url = new TextDecoder().decode(artifact.data);
                        }
                        acc[artifact.id] = item;
                    }
                    return acc;
                },
                {} as Record<string, ArtifactMapping>,
            );

            const evidenceMapping: EvidenceMapping = {
                artifacts: artifactMapping,
                byRequirements: requirementsMapping,
            };


            await download(evidenceMapping, revision);
        }
    };

    const [_, formAction, isPending] = useActionState(onClick, null);
    return (
        <>
            <form action={formAction}>
                <button
                    type="submit"
                    className={menuItemClasses()}
                    disabled={isPending}
                    tabIndex={-1}
                >
                    <span>Download Evidence Map</span>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-4"
                    >
                        <path
                            fillRule="evenodd"
                            d="M11.906 1.994a8 8 0 0 1 8.09 8.421 8 8 0 0 1-1.297 3.957 1 1 0 0 1-.133.204l-.108.129q-.268.365-.573.699l-5.112 6.224a1 1 0 0 1-1.545 0L5.982 15.26l-.002-.002a18 18 0 0 1-.309-.38l-.133-.163a1 1 0 0 1-.13-.202 7.995 7.995 0 0 1 6.498-12.518ZM15 9.997a3 3 0 1 1-5.999 0 3 3 0 0 1 5.999 0"
                            clipRule="evenodd"
                        />
                    </svg>
                </button>
            </form>
        </>
    );
};
