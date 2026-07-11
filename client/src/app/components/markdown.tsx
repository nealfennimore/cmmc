"use client";
import { toDataURL } from "@/app/components/security_requirements/utils";
import { Status } from "@/app/components/status";
import { useManifestContext } from "@/app/context/manifest";
import { toNum, toPath, useRevisionContext } from "@/app/context/revision";
import { IDB, IDBSecurityRequirement } from "@/app/db";
import { embeddable, saveBlob, snippetable, toFSName } from "@/app/utils/file";
import { isFreeTier, isUnlocked } from "@/app/utils/tier";
import { useActionState } from "react";
import { confirmOptions } from "./confirm";
import { menuItemClasses } from "./ui";

const toStatus = (status?: Status) => {
    switch (status) {
        case Status.IMPLEMENTED:
            return "🟢 Implemented";
        case Status.NOT_IMPLEMENTED:
            return "🔴 Not Implemented";
        case Status.NOT_APPLICABLE:
            return "⚫ Not Applicable";
        default:
            return "⚪ Unknown";
    }
};

export const Markdown = () => {
    const manifest = useManifestContext();
    const revision = useRevisionContext();
    const path = toPath(revision);

    const onClick = async () => {
        const choices = await confirmOptions({
            title: "Generate markdown report",
            message: "Choose what to include in the generated markdown file.",
            options: [
                {
                    key: "includeLinks",
                    label: "Include evidence links",
                    description:
                        "Add links to evidence in the generated file.",
                    default: true,
                },
                {
                    key: "embedArtifacts",
                    label: "Embed evidence files",
                    description:
                        "Embed evidence files directly into the generated file.",
                },
            ],
            confirmLabel: "Generate",
        });
        if (!choices) return;

        const shouldIncludeLinks = choices.includeLinks;
        const shouldEmbedArtifacts = choices.embedArtifacts;

        const idbSecurityRequirements = await IDB.securityRequirements.getAll();

        const storedSecRequirements = idbSecurityRequirements.reduce(
            (acc, cur) => {
                acc[cur.id] = cur;
                return acc;
            },
            {} as Record<string, IDBSecurityRequirement>,
        );

        const payload = [
            isFreeTier()
                ? "# NIST SP 800-171 CMMC Level 1 Report"
                : "# NIST SP 800-171 Rev 3 Report",
        ];

        for (const family of manifest.families.elements) {
            // Free tier: report covers only the unlocked (Level 1)
            // requirements; families with none are omitted entirely.
            const requirements = manifest.requirements.byFamily[
                family.id
            ].filter((requirement) => isUnlocked(requirement.id));
            if (!requirements.length) {
                continue;
            }

            payload.push(`## ${family.element_identifier}: ${family.title}`);

            for (const requirement of requirements) {
                payload.push(
                    `### ${requirement.element_identifier}: ${requirement.title}`,
                );

                const evidenceRequirementRecords =
                    await IDB.evidenceRequirements.getAll(
                        IDBKeyRange.only(requirement.id),
                        "requirement_id",
                    );

                const artifacts = (
                    await Promise.all(
                        evidenceRequirementRecords.map((record) =>
                            IDB.evidence.getAll(record.evidence_id),
                        ),
                    )
                ).flat();

                const linkArtifacts = artifacts.filter(
                    (artifact) => artifact.type === "url",
                );
                const fileArtifacts = artifacts.filter(
                    (artifact) => artifact.type !== "url",
                );

                const path = requirement.element_identifier
                    .split(".")
                    .join("/");

                if (
                    (shouldIncludeLinks || shouldEmbedArtifacts) &&
                    (linkArtifacts.length || fileArtifacts.length)
                ) {
                    payload.push("#### Evidence");
                }

                if (
                    shouldIncludeLinks &&
                    (linkArtifacts.length || fileArtifacts.length)
                ) {
                    const links = linkArtifacts
                        .map(
                            (artifact) =>
                                `- [${
                                    artifact.filename
                                }](${new TextDecoder().decode(artifact.data)})`,
                        )
                        .join("\n");

                    payload.push(links);

                    if (!shouldEmbedArtifacts && fileArtifacts.length) {
                        const embedLinks = fileArtifacts
                            .map(
                                (artifact) =>
                                    `- [${artifact.filename}](./${path}/${toFSName(artifact)})`,
                            )
                            .join("\n");

                        payload.push(embedLinks);
                    }
                }

                if (shouldEmbedArtifacts && fileArtifacts.length) {
                    const embedArtifacts = Promise.all(
                        fileArtifacts.map(async (artifact) => {
                            if (embeddable(artifact)) {
                                const file = new File(
                                    [artifact.data],
                                    artifact.filename,
                                    {
                                        type: artifact.type,
                                    },
                                );
                                const url = await toDataURL(file);
                                return `![${artifact.filename}](${url})`;
                            } else if (snippetable(artifact)) {
                                const idx = artifact.type.lastIndexOf("/");
                                const type = artifact.type.slice(idx + 1);

                                return `\`\`\`${type}
                                ${new TextDecoder().decode(artifact.data)}

\`\`\``;
                            } else {
                                console.warn(
                                    `No work to do for ${artifact.type}: ${artifact.filename}`,
                                );
                                return `[${artifact.filename}](${toFSName(artifact)})`;
                            }
                        }),
                    );

                    payload.push((await embedArtifacts).join("\n\n"));
                }

                for (const secReq of manifest.securityRequirements
                    .byRequirements[requirement.id]) {
                    payload.push(`#### ${secReq.subSubRequirement}`);
                    payload.push(`> ${secReq.text}`);

                    const stored =
                        storedSecRequirements[secReq.subSubRequirement];
                    if (stored) {
                        payload.push(
                            `**${toStatus(stored.status as Status)}**`,
                        );
                        payload.push(`${stored.description}`);
                    } else {
                        payload.push(
                            `**${toStatus()} [${secReq.subSubRequirement}](${
                                window.location.origin
                            }/${path}/requirement/${secReq.requirement}#${
                                secReq.subSubRequirement
                            })**`,
                        );
                    }
                }
            }
        }

        // Create a Blob object with the text data
        const blob = new Blob([payload.join("\n\n")], {
            type: "text/plain",
        });

        const timestamp = Math.floor(new Date().getTime() / 1000);

        await saveBlob(
            `cmmc-800-171-rev-${toNum(revision)}-report-${timestamp}.md`,
            blob,
        );
        return payload;
    };

    const [_, formAction, isPending] = useActionState(onClick, null);
    return (
        <form action={formAction}>
            <button
                type="submit"
                className={menuItemClasses()}
                disabled={isPending}
                tabIndex={-1}
            >
                <span>Generate Report</span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="h-4"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12.5 2h2.7c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C20 4.28 20 5.12 20 6.8v10.4c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C17.72 22 16.88 22 15.2 22H8.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C4 19.72 4 18.88 4 17.2v-.7M16 13h-4.5M16 9h-3.5m3.5 8H8m-2-7V4.5a1.5 1.5 0 1 1 3 0V10a3 3 0 1 1-6 0V6"
                    />
                </svg>
            </button>
        </form>
    );
};
