"use client";
import { Status } from "@/app/components/status";
import { toNum, useRevisionContext } from "@/app/context/revision";
import {
    IDB,
    IDBEvidence,
    IDBEvidenceRequirement,
    IDBEvidenceV2,
    IDBExamineEvidence,
    IDBRequirement,
    IDBSecurityRequirement,
    resetEvidenceIdMigration,
} from "@/app/db";
import { useNotification } from "@/app/context/notification";
import { fromBase64, toBase64 } from "@/app/utils/base64";
import { saveBlob } from "@/app/utils/file";
import { openJsonFile } from "@/app/utils/tauri";
import { useActionState, useRef } from "react";
import { confirm } from "./confirm";
import { showLoader, withLoader } from "./loader";
import { menuItemClasses } from "./ui";

type PortableIDBEvidence = Omit<IDBEvidence, "data"> & {
    data: Array<number>;
};
type PortableIDBEvidenceV2 = Omit<IDBEvidenceV2, "data"> & {
    data: Array<number>;
};
// v6 exports carry evidence bytes as base64 — byte-per-JSON-number arrays
// made 100MB+ exports stall (and ~4x larger on disk).
type PortableIDBEvidenceV3 = Omit<IDBEvidenceV2, "data"> & {
    data: string;
};

// Export payload version — the IDB schema version, kept in lockstep (the DB
// got an empty v6 migration when evidence data switched from number arrays
// to base64 in the export format).
const EXPORT_VERSION = IDB.version;

interface ImportExportPayload {
    securityRequirements: IDBSecurityRequirement[];
    evidence?:
        | PortableIDBEvidence[]
        | PortableIDBEvidenceV2[]
        | PortableIDBEvidenceV3[];
    evidenceRequirements?: IDBEvidenceRequirement[];
    examineEvidence?: IDBExamineEvidence[];
    version: number;
}


// Builds the full-database payload and saves it as JSON, behind the full-page
// loader (the loader stays up over the native save dialog too — the write
// after picking a location is part of the task). Shared by the navigation menu
// export and the license gate's data export, which runs outside the app's
// providers — so this must stay context-free.
export const exportDatabase = (filenamePrefix: string) =>
    withLoader("Exporting database…", () => buildAndSaveExport(filenamePrefix));

const buildAndSaveExport = async (filenamePrefix: string) => {
    const idbSecurityRequirements = await IDB.securityRequirements.getAll();
    const idbEvidence = await IDB.evidence.getAll();
    const idbEvidenceRequirements = await IDB.evidenceRequirements.getAll();
    const idbExamineEvidence = await IDB.examineEvidence.getAll();
    // Encode via the engine-native base64 path; a JS spread over the bytes
    // stalls for minutes on large evidence sets.
    const evidence: PortableIDBEvidenceV3[] = await Promise.all(
        idbEvidence.map(async (artifact) => ({
            ...artifact,
            data: await toBase64(artifact.data),
        })),
    );
    const validSecurityRequirements = idbSecurityRequirements.filter(
        (secReq) => !!(secReq.status || secReq.description),
    );

    const payload: ImportExportPayload = {
        securityRequirements: validSecurityRequirements,
        evidence,
        evidenceRequirements: idbEvidenceRequirements,
        examineEvidence: idbExamineEvidence,
        version: EXPORT_VERSION,
    };

    // Since v6 the payload holds no numeric arrays (evidence bytes are
    // base64 strings), so plain pretty-printed stringify is fine.
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });

    const timestamp = Math.floor(new Date().getTime() / 1000);

    await saveBlob(`${filenamePrefix}-export-${timestamp}.json`, blob);
    return payload;
};

export const Export = () => {
    const revision = useRevisionContext();
    const action = () => exportDatabase(`cmmc-800-171-rev-${toNum(revision)}`);

    const [_, formAction, isPending] = useActionState(action, null);
    return (
        <form action={formAction}>
            <button
                type="submit"
                className={menuItemClasses()}
                disabled={isPending}
                tabIndex={-1}
            >
                <span>Export Database</span>
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
                        d="M21 5c0 1.657-4.03 3-9 3S3 6.657 3 5m18 0c0-1.657-4.03-3-9-3S3 3.343 3 5m18 0v14c0 1.66-4 3-9 3s-9-1.34-9-3V5m18 7c0 1.66-4 3-9 3s-9-1.34-9-3"
                    />
                </svg>
            </button>
        </form>
    );
};

// Parses an exported JSON payload and replaces the database with it, then
// reloads so every view rehydrates from the new data. No-op when the user
// declines the overwrite confirmation; throws on malformed/unsupported files.
const importDatabase = async (text: string): Promise<void> => {
    // Parsing a 100MB+ export blocks the main thread for a while, so it gets
    // its own loader stage — dropped before the confirm dialog, which the
    // overlay would otherwise sit on top of and block.
    const payload = await withLoader("Reading backup file…", () => {
        const payload = JSON.parse(text) as ImportExportPayload;

        // v3 reshaped evidence into separate evidence + evidence_requirements
        // stores. v4 -> v5 only added the examine_evidence store, so v4
        // exports import as-is (just without any examine checklist data). v6
        // only changed evidence bytes to base64, handled per artifact below.
        if (payload.version === 3) {
            const evidenceV1 = payload.evidence as
                | PortableIDBEvidence[]
                | undefined;

            const evidenceRequirements = evidenceV1?.map((artifact) => ({
                evidence_id: artifact.uuid,
                requirement_id: artifact.requirement_id as string,
            }));
            const evidenceV2 = evidenceV1?.map(
                (artifact) =>
                    ({
                        id: artifact.uuid,
                        type: artifact.type,
                        filename: artifact.filename,
                        data: artifact.data,
                    }) as PortableIDBEvidenceV2,
            );

            if (evidenceRequirements?.length) {
                payload.evidenceRequirements = evidenceRequirements;
            }

            if (evidenceV2?.length) {
                payload.evidence = evidenceV2;
            }
        } else if (payload.version < 4 || payload.version > EXPORT_VERSION) {
            throw new Error("Database version mismatch");
        }

        return payload;
    });

    const confirmed = await confirm({
        title: "Import database",
        message:
            "Importing will overwrite the current database, replacing all existing requirements and evidence. This cannot be undone.",
        confirmLabel: "Overwrite & import",
        variant: "destructive",
    });
    if (!confirmed) {
        return;
    }

    // showLoader (not withLoader) so the overlay stays up through the reload —
    // hiding it first would flash the not-yet-rehydrated app.
    const hideLoader = showLoader("Importing database…");
    try {
        await IDB.securityRequirements.clear();
        await IDB.requirements.clear();
        await IDB.evidenceRequirements.clear();
        await IDB.evidence.clear();
        await IDB.examineEvidence.clear();

        const requirements: Record<string, IDBRequirement> = {};

        for (const secReq of payload.securityRequirements) {
            const reqId = secReq.id.slice(0, 8);
            await IDB.securityRequirements.put(secReq);
            if (!requirements[reqId]) {
                requirements[reqId] = {
                    id: reqId,
                    bySecurityRequirementId: {},
                };
            }
            requirements[reqId].bySecurityRequirementId[secReq.id] =
                secReq.status as Status;
        }

        for (const req of Object.values(requirements)) {
            await IDB.requirements.put(req);
        }

        for (const artifact of payload?.evidence || []) {
            const _artifact = {
                ...artifact,
                // v6 exports carry base64; v3-v5 number arrays.
                data:
                    typeof artifact.data === "string"
                        ? await fromBase64(artifact.data)
                        : new Uint8Array(artifact.data).buffer,
            };
            await IDB.evidence.put(_artifact);
        }

        for (const evidenceRequirement of payload?.evidenceRequirements ||
            []) {
            await IDB.evidenceRequirements.put(evidenceRequirement);
        }

        for (const examineEvidence of payload?.examineEvidence || []) {
            await IDB.examineEvidence.put(examineEvidence);
        }

        // An imported backup can carry legacy (UUID/sha1) evidence ids, so let
        // the id migration re-run on the reload.
        resetEvidenceIdMigration();
    } catch (error) {
        hideLoader();
        throw error;
    }
    window.location.reload();
};

export const Import = () => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { addNotification } = useNotification();

    const runImport = async (text: string) => {
        try {
            await importDatabase(text);
        } catch (error) {
            console.error("Import failed", error);
            addNotification({
                text: `Import failed: ${error instanceof Error ? error.message : error}`,
            });
        }
    };

    const action = async (prevState, formData: FormData) => {
        const file = formData.get("file") as File;
        if (file) {
            await runImport(await file.text());
        }
    };

    const onClick = async () => {
        // Native dialog in the desktop shell — the webview's file input is
        // unreliable there (WebView2 can hide *.json files entirely when the
        // registry lacks a MIME mapping for .json).
        const text = await openJsonFile();
        if (text === false) {
            inputRef.current?.click();
            return;
        }
        if (text !== null) {
            await runImport(text);
        }
    };

    const [_, formAction, isPending] = useActionState(action, null);
    return (
        <form action={formAction}>
            <input
                id="file"
                name="file"
                type="file"
                accept="application/json,.json"
                ref={inputRef}
                className="hidden"
                onChange={(event) => {
                    if (event?.target?.files?.length) {
                        event?.target?.form?.requestSubmit();
                    }
                }}
            />
            <button
                type={"button"}
                className={menuItemClasses()}
                disabled={isPending}
                tabIndex={-1}
                onClick={onClick}
            >
                <span>Import Database</span>
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
                        d="m8 16 4-4m0 0 4 4m-4-4v9m8-4.257A5.5 5.5 0 0 0 16.5 7a.62.62 0 0 1-.534-.302 7.5 7.5 0 1 0-11.78 9.096"
                    />
                </svg>
            </button>
        </form>
    );
};
