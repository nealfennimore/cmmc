"use client";
import { FileBadge, LinkBadge } from "@/app/components/evidence";
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
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        (async function () {
            setEvidenceWithRequirements(await fetchEvidence());
        })();
    }, []);

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
                    artifact.type === "url" ? (
                        <LinkBadge artifact={artifact} hideIcon />
                    ) : (
                        <FileBadge artifact={artifact} hideIcon />
                    ),
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
        </form>
    );
};
