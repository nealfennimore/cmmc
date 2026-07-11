"use client";
import { confirm } from "@/app/components/confirm";
import { FileBadge, LinkBadge } from "@/app/components/evidence";
import { EditEvidenceModal } from "@/app/components/security_requirements/evidence";
import {
    defaultFilter,
    defaultSort,
    Order,
    Table,
} from "@/app/components/table";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { IDB, IDBEvidenceV2 } from "@/app/db";
import { hashType } from "@/app/utils/file";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface Requirements {
    requirements: string[];
}

interface EvidenceWithRequirements extends IDBEvidenceV2, Requirements {}

async function fetchEvidence(): Promise<EvidenceWithRequirements[]> {
    const evidenceRequirementRecords = await IDB.evidenceRequirements.getAll();
    const requirementsByEvidenceId = evidenceRequirementRecords.reduce(
        (acc, record) => {
            if (!acc[record.evidence_id]) {
                acc[record.evidence_id] = [];
            }
            acc?.[record.evidence_id]?.push(record.requirement_id);
            return acc;
        },
        {} as { [key: string]: string[] },
    );

    const evidence = await IDB.evidence.getAll();

    return evidence.map(
        (artifact) =>
            ({
                ...artifact,
                requirements: (
                    requirementsByEvidenceId[artifact.id] || []
                ).sort(),
            }) as EvidenceWithRequirements,
    );
}

const nestedSort = (a?: string[], b?: string[]) => defaultSort(a?.[0], b?.[0]);
const sorters = [defaultSort, defaultSort, nestedSort, defaultSort];

const nestedFilter = (search: string) => (values: string[]) =>
    values.some((value) => value.includes(search));
const filters = [defaultFilter, defaultFilter, nestedFilter, null];

export const EvidenceTable = () => {
    const [evidenceWithRequirements, setEvidenceWithRequirements] = useState<
        EvidenceWithRequirements[]
    >([]);
    const [editing, setEditing] = useState<EvidenceWithRequirements | null>(
        null,
    );
    const formRef = useRef<HTMLFormElement>(null);

    const refresh = async () =>
        setEvidenceWithRequirements(await fetchEvidence());

    useEffect(() => {
        refresh();
    }, []);

    // The table has no requirement context, so deletion removes the artifact
    // and all of its requirement links.
    const deleteEverywhere = async (
        artifact: EvidenceWithRequirements,
    ): Promise<boolean> => {
        const count = artifact.requirements.length;
        const shouldDelete = await confirm({
            title: "Delete evidence",
            message:
                count > 1
                    ? `Delete "${artifact.filename}"? It will be removed from all ${count} requirements it is attached to. This cannot be undone.`
                    : `Delete "${artifact.filename}"? This cannot be undone.`,
            confirmLabel: "Delete",
            variant: "destructive",
        });
        if (!shouldDelete) {
            return false;
        }
        const links = await IDB.evidenceRequirements.getAll(
            IDBKeyRange.only(artifact.id),
            "evidence_id",
        );
        for (const link of links) {
            await IDB.evidenceRequirements.delete([
                link.evidence_id,
                link.requirement_id,
            ]);
        }
        await IDB.evidence.delete(IDBKeyRange.only(artifact.id));
        await refresh();
        return true;
    };

    const revision = useRevisionContext();
    const path = toPath(revision);

    const tableHeaders = useMemo(
        () => [
            {
                text: "Filename",
                filterable: true,
            },
            {
                text: "Type",
                filterable: true,
                className: "min-w-[195px] max-md:hidden",
            },
            {
                text: "Requirements",
                filterable: true,
                className: "min-w-[250px] max-w-[250px]",
            },
            {
                text: "File Hash",
                filterable: false,
                className: "max-lg:hidden",
            },
        ],
        [],
    );

    const tableBody = useMemo(
        () =>
            evidenceWithRequirements?.map((artifact) => ({
                values: [
                    artifact.filename,
                    artifact.type,
                    artifact.requirements,
                    artifact.id,
                ],
                columns: [
                    <span
                        key={artifact.id}
                        className="flex items-center gap-1"
                    >
                        {artifact.type === "url" ? (
                            <LinkBadge artifact={artifact} hideIcon />
                        ) : (
                            <FileBadge artifact={artifact} hideIcon />
                        )}
                        <button
                            type="button"
                            onClick={() => setEditing(artifact)}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Edit evidence"
                        >
                            <svg
                                className="w-3 h-3"
                                aria-hidden="true"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    d="m18 10-4-4M2.5 21.5l3.384-.376c.414-.046.62-.069.814-.131a2 2 0 0 0 .485-.234c.17-.111.317-.259.61-.553L21 7a2.828 2.828 0 1 0-4-4L3.794 16.206c-.294.294-.442.442-.553.611a2 2 0 0 0-.234.485c-.062.193-.085.4-.131.814z"
                                />
                            </svg>
                        </button>
                    </span>,
                    artifact.type,
                    artifact.requirements.map((requirement) => (
                        <Link
                            key={`${artifact.id}-${requirement}`}
                            href={`${path}/requirement/${requirement}`}
                            className="mr-2 text-primary hover:underline"
                        >
                            {requirement}
                        </Link>
                    )),
                    <div
                        key={artifact.id}
                        className="truncate w-full"
                        title={artifact.id}
                    >
                        {hashType(artifact.id)}:{artifact.id}
                    </div>,
                ],
                classNames: [
                    null,
                    "max-md:hidden",
                    "flex flex-wrap",
                    "max-lg:hidden md:max-w-48 xl:max-w-full",
                ],
            })) ?? [],
        [evidenceWithRequirements, path],
    );

    return (
        <form
            ref={formRef}
            onSubmit={(e) => e.preventDefault()}
            className="w-full"
        >
            <section className="w-full flex flex-col">
                <div className="relative overflow-x-auto rounded-lg border border-border shadow-sm">
                    <Table
                        sorters={sorters}
                        filters={filters}
                        tableHeaders={tableHeaders}
                        tableBody={tableBody}
                        initialOrders={[
                            Order.ASC,
                            Order.NONE,
                            Order.NONE,
                            Order.NONE,
                        ]}
                        formRef={formRef}
                    />
                </div>
            </section>
            {editing && (
                <EditEvidenceModal
                    artifact={editing}
                    onChanged={refresh}
                    onDelete={() => deleteEverywhere(editing)}
                    onClose={() => setEditing(null)}
                />
            )}
        </form>
    );
};
