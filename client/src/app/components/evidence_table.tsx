"use client";
import { examineItemName } from "@/api/entities/ExamineItemIds";
import { confirm } from "@/app/components/confirm";
import { FileBadge, LinkBadge } from "@/app/components/evidence";
import { EditEvidenceModal } from "@/app/components/security_requirements/evidence";
import { Stats } from "@/app/components/stats";
import {
    defaultFilter,
    defaultSort,
    Order,
    Table,
} from "@/app/components/table";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { IDB, IDBEvidenceV2, removeEvidenceExamineTags } from "@/app/db";
import { mimeLabel } from "@/app/utils/file";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface Requirements {
    requirements: string[];
    /** Names of the shared Examine documents this artifact is tagged as. */
    attachedAs: string[];
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

    const tagRecords = await IDB.evidenceExamineItems.getAll();
    const attachedAsByEvidenceId = tagRecords.reduce(
        (acc, tag) => {
            if (!acc[tag.evidence_id]) {
                acc[tag.evidence_id] = [];
            }
            // Fall back to the raw slug for ids no longer in the mapping.
            acc[tag.evidence_id].push(
                examineItemName(tag.examine_id) ?? tag.examine_id,
            );
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
                attachedAs: (attachedAsByEvidenceId[artifact.id] || []).sort(),
            }) as EvidenceWithRequirements,
    );
}

const nestedSort = (a?: string[], b?: string[]) => defaultSort(a?.[0], b?.[0]);
const sorters = [
    defaultSort,
    defaultSort,
    nestedSort,
    nestedSort,
    defaultSort,
    null,
];

const nestedFilter = (search: string) => (values: string[]) =>
    values.some((value) => value.includes(search));
// The hash filter matches on the full id (row values), so pasting a complete
// hash works even though the cell only displays a short prefix.
const filters = [
    defaultFilter,
    defaultFilter,
    nestedFilter,
    nestedFilter,
    defaultFilter,
    null,
];

// Enough of a git-style prefix to visually tell artifacts apart.
const HASH_DISPLAY_CHARS = 12;

export const EvidenceTable = () => {
    const [evidenceWithRequirements, setEvidenceWithRequirements] = useState<
        EvidenceWithRequirements[]
    >([]);
    const [editing, setEditing] = useState<EvidenceWithRequirements | null>(
        null,
    );
    // Set by clicking a type stat card; narrows the rows fed to the table
    // (the table's own column filters then apply on top).
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
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
        await removeEvidenceExamineTags(artifact.id);
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
                filterKind: "select" as const,
                className: "min-w-[195px] max-md:hidden",
            },
            {
                text: "Requirements",
                filterable: true,
                filterKind: "select" as const,
                className: "min-w-[250px] max-w-[250px]",
            },
            {
                text: "Attached as",
                filterable: true,
                filterKind: "select" as const,
                className: "min-w-[200px] max-lg:hidden",
            },
            {
                text: "File Hash (SHA-256)",
                filterable: true,
                className: "max-lg:hidden",
            },
            {
                text: "",
                filterable: false,
                className: "w-10",
            },
        ],
        [],
    );

    // Total first, then one entry per artifact type (matching the raw types
    // shown in the Type column), most common first. Clicking a type card
    // toggles the table down to that type; the total card clears it.
    const stats = useMemo(() => {
        const byType = new Map<string, number>();
        for (const artifact of evidenceWithRequirements) {
            const label = mimeLabel(artifact.type);
            byType.set(label, (byType.get(label) ?? 0) + 1);
        }
        return [
            {
                label: "Total evidence",
                value: evidenceWithRequirements.length,
                onClick: () => setTypeFilter(null),
            },
            ...[...byType.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([type, count]) => ({
                    label: type,
                    value: count,
                    onClick: () =>
                        setTypeFilter((current) =>
                            current === type ? null : type,
                        ),
                    active: typeFilter === type,
                })),
        ];
    }, [evidenceWithRequirements, typeFilter]);

    const visibleEvidence = useMemo(
        () =>
            typeFilter
                ? evidenceWithRequirements.filter(
                      (artifact) => mimeLabel(artifact.type) === typeFilter,
                  )
                : evidenceWithRequirements,
        [evidenceWithRequirements, typeFilter],
    );

    const tableBody = useMemo(
        () =>
            visibleEvidence?.map((artifact) => ({
                values: [
                    artifact.filename,
                    mimeLabel(artifact.type),
                    artifact.requirements,
                    artifact.attachedAs,
                    artifact.id,
                    "",
                ],
                columns: [
                    artifact.type === "url" ? (
                        <LinkBadge artifact={artifact} hideIcon />
                    ) : (
                        <FileBadge artifact={artifact} hideIcon />
                    ),
                    <span key={artifact.id} title={artifact.type}>
                        {mimeLabel(artifact.type)}
                    </span>,
                    artifact.requirements.map((requirement) => (
                        <Link
                            key={`${artifact.id}-${requirement}`}
                            href={`${path}/requirement/${requirement}`}
                            className="mr-2 text-primary hover:underline"
                        >
                            {requirement}
                        </Link>
                    )),
                    artifact.attachedAs.map((name) => (
                        <span
                            key={`${artifact.id}-${name}`}
                            className="mb-1 mr-1 inline-block rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
                        >
                            {name}
                        </span>
                    )),
                    // Hovering the short hash reveals the full value in a
                    // card-styled tooltip; as a child of the hovered element
                    // it stays open when moused over, so it can be selected
                    // and copied.
                    <div
                        key={artifact.id}
                        className="group relative w-fit cursor-help"
                    >
                        {artifact.id.slice(0, HASH_DISPLAY_CHARS)}&hellip;
                        <span className="invisible absolute bottom-full right-0 z-10 mb-1 w-max rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-card-foreground shadow-md group-hover:visible">
                            {artifact.id}
                        </span>
                    </div>,
                    <button
                        key={artifact.id}
                        type="button"
                        onClick={() => setEditing(artifact)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Edit evidence"
                    >
                        <svg
                            className="w-4 h-4"
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
                    </button>,
                ],
                classNames: [
                    null,
                    "max-md:hidden",
                    "flex flex-wrap",
                    "max-lg:hidden",
                    "max-lg:hidden md:max-w-48 xl:max-w-full",
                    null,
                ],
            })) ?? [],
        [visibleEvidence, path],
    );

    return (
        <form
            ref={formRef}
            onSubmit={(e) => e.preventDefault()}
            className="w-full"
        >
            <section className="w-full flex flex-col">
                <Stats stats={stats} />
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
