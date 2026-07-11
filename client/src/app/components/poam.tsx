"use client";
import { Status } from "@/app/components/status";
import { useManifestContext } from "@/app/context/manifest";
import { toNum, useRevisionContext } from "@/app/context/revision";
import { IDB, IDBSecurityRequirement } from "@/app/db";
import { saveBlob } from "@/app/utils/file";
import { isUnlocked } from "@/app/utils/tier";
import { useActionState } from "react";
import { menuItemClasses } from "./ui";

export const POAM = () => {
    const manifest = useManifestContext();
    const revision = useRevisionContext();

    const onClick = async () => {
        const idbSecurityRequirements = await IDB.securityRequirements.getAll();
        const storedSecRequirements = idbSecurityRequirements.reduce(
            (acc, cur) => {
                acc[cur.id] = cur;
                return acc;
            },
            {} as Record<string, IDBSecurityRequirement>,
        );

        const header = [
            "Weaknesses",
            "Description",
            "Responsible Office/Organization",
            "Resource Estimate",
            "Scheduled Completion Date",
            "Changes to Milestone",
            "How was the weakness identified?",
            "Status",
        ];

        const body = [];

        for (const secReq of manifest.securityRequirements.elements) {
            // Free tier: the POA&M covers only the unlocked (Level 1) set.
            if (!isUnlocked(secReq.requirement)) {
                continue;
            }
            const element = storedSecRequirements[secReq.subSubRequirement];
            if (!element || element.status !== Status.NOT_IMPLEMENTED) {
                continue;
            }
            body.push([
                secReq.element_identifier,
                secReq.text.replaceAll(",", ""),
                "",
                "",
                "",
                "",
                "",
                "",
            ]);
        }

        const payload = [header.join(",")].concat(
            body.map((row) => row.join(",")),
        );

        // Create a Blob object with the text data
        const blob = new Blob([payload.join("\n\n")], {
            type: "text/csv",
        });

        const timestamp = Math.floor(new Date().getTime() / 1000);

        await saveBlob(
            `cmmc-800-171-rev-${toNum(revision)}-poam-${timestamp}.md`,
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
                <span>Generate POAM</span>
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
                        d="M16 4c.93 0 1.395 0 1.776.102a3 3 0 0 1 2.122 2.122C20 6.605 20 7.07 20 8v9.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C17.72 22 16.88 22 15.2 22H8.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C4 19.72 4 18.88 4 17.2V8c0-.93 0-1.395.102-1.776a3 3 0 0 1 2.122-2.122C6.605 4 7.07 4 8 4m1 11 2 2 4.5-4.5M9.6 6h4.8c.56 0 .84 0 1.054-.109a1 1 0 0 0 .437-.437C16 5.24 16 4.96 16 4.4v-.8c0-.56 0-.84-.109-1.054a1 1 0 0 0-.437-.437C15.24 2 14.96 2 14.4 2H9.6c-.56 0-.84 0-1.054.109a1 1 0 0 0-.437.437C8 2.76 8 3.04 8 3.6v.8c0 .56 0 .84.109 1.054a1 1 0 0 0 .437.437C8.76 6 9.04 6 9.6 6"
                    />
                </svg>
            </button>
        </form>
    );
};
