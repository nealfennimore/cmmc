"use client";
import { IDB, IDBEvidenceV2 } from "@/app/db";
import { saveBlob, toFSName } from "@/app/utils/file";
import { saveFilesToDirectory } from "@/app/utils/tauri";
import Link from "next/link";
import { useActionState } from "react";
import { confirm } from "./confirm";
import { menuItemClasses } from "./ui";

const toFile = (artifact: IDBEvidenceV2) =>
    new File([artifact.data], artifact.filename, { type: artifact.type });

const exportEvidence = async (artifacts: IDBEvidenceV2[]) => {
    // In the desktop shell, write the whole set into one chosen folder rather
    // than firing a save dialog per file.
    if (
        await saveFilesToDirectory(
            artifacts.map((artifact) => ({
                filename: toFSName(artifact),
                blob: toFile(artifact),
            })),
        )
    ) {
        return;
    }

    await Promise.all(
        artifacts.map((artifact) =>
            saveBlob(toFSName(artifact), toFile(artifact)),
        ),
    );
};

export const ViewEvidence = ({ path }) => (
    <Link
        href={`${path}/evidence`}
        className={menuItemClasses()}
        tabIndex={-1}
    >
        <span>View Evidence</span>
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
                d="M3 11h18M3 15h18m-9-4v8m-8 0h16a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Z"
            />
        </svg>
    </Link>
);

export const ExportEvidence = () => {
    const onClick = async () => {
        if (
            await confirm({
                title: "Download evidence",
                message:
                    "This will download all uploaded evidence files to your device.",
                confirmLabel: "Download",
            })
        ) {
            const evidence = await IDB.evidence.getAll();
            await exportEvidence(
                evidence.filter((artifact) => artifact.type !== "url"),
            );
        }
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
                <span>Download Evidence</span>
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
                        d="M21 15v1.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C18.72 21 17.88 21 16.2 21H7.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C3 18.72 3 17.88 3 16.2V15m14-5-5 5m0 0-5-5m5 5V3"
                    />
                </svg>
            </button>
        </form>
    );
};
