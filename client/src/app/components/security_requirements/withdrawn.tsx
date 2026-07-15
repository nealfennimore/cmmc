"use client";
import { toPath, useRevisionContext } from "@/app/context/revision";
import Link from "next/link";
import { Breadcrumbs } from "../breadcrumbs";
import { DataTable } from "../datatable";
import { EvidenceState } from "../evidence";
import { IconInfo } from "../icons";
import { Popover } from "../popover";
import { StatusState } from "../status";
import { Heading } from "../ui";
import { UpgradeBanner } from "../upgrade_cta";
import { SecurityForm } from "./security_form";

const secReqReg = /\d{2}.\d{2}.\d{2},?/gm;

const WithdrawnInto = ({ text }: { text: string }) => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    if (secReqReg.test(text)) {
        const base = text
            .replaceAll(secReqReg, "")
            .replace("and", "")
            .replace(".", "");

        const links = text.match(secReqReg)?.map((id) => {
            const _id = id.replace(",", "");
            return (
                <Link
                    key={_id}
                    href={`${path}/requirement/${_id}`}
                    className="mr-1 text-xs text-primary hover:underline"
                >
                    {id}
                </Link>
            );
        }) as JSX.Element[];

        return [base, ...links];
    }

    return text;
};

export const WithdrawnSecurityRequirement = ({
    initialState,
    isHydrating,
    manifest,
    next,
    prev,
    requirement,
    requirementId,
    setInitialState,
    setStatuses,
    statuses,
    value,
    withdrawn,
    groupings,
    evidence,
    locked,
}) => {
    return (
        <>
            <Breadcrumbs requirementId={requirementId} />

            {locked && <UpgradeBanner />}

            <Heading
                level={2}
                as="h3"
                className="mt-6 flex flex-wrap items-center gap-2"
            >
                Security Requirements for {requirement.requirement}
                <StatusState statuses={statuses} />
                <EvidenceState evidence={evidence} />
            </Heading>

            <div
                id="alert-additional-content-5"
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
                role="alert"
            >
                <div className="flex items-center gap-1">
                    <IconInfo />
                    <span className="sr-only">Info</span>
                    <h4 className="text-lg font-semibold text-amber-900">
                        Withdrawn
                    </h4>
                </div>
                <div className="mt-2 text-sm text-amber-800">
                    <p>
                        This security requirement has been withdrawn from
                        NIST-SP 800-171 revision 3, but is retained as CMMC is
                        using revision 2.
                    </p>
                </div>
            </div>

            <p
                className="text-base discussion"
                dangerouslySetInnerHTML={{
                    __html:
                        manifest.discussions.byRequirements[requirementId]?.[0]
                            ?.text || "",
                }}
            ></p>

            <aside className="flex flex-wrap justify-between items-center w-full mx-auto">
                <div className="flex mb-4 sm:mb-1">
                    <a
                        href={`https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_171_3_0_0/home?element=${requirement.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                        View CPRT {requirement.id}
                    </a>
                </div>
                <DataTable
                    rows={[
                        {
                            title: (
                                <>
                                    <button
                                        popoverTarget="revision-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">Revision</span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="revision-popover">
                                        <IconInfo />
                                        <span>
                                            What NIST 800-171 revision(s) this
                                            control appears in.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible: value?.revision?.length,
                            value: value?.revision?.join(", "),
                        },
                        {
                            title: (
                                <>
                                    <button
                                        popoverTarget="value-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">Value</span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="value-popover">
                                        <IconInfo />
                                        <span>
                                            The value this control has currently
                                            in CMMC.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible: true,
                            value: value?.value,
                        },
                        {
                            title: "Partial Value",
                            visible: (value?.partial_value ?? 0) > 0,
                            value: value?.partial_value,
                        },
                        {
                            title: (
                                <>
                                    <button
                                        popoverTarget="deprecated-value-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">
                                            Withdrawn Reason
                                        </span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="deprecated-value-popover">
                                        <IconInfo />
                                        <span>
                                            Why this security control was
                                            withdrawn.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible: true,
                            className: "hidden md:block",
                            value: (
                                <WithdrawnInto
                                    text={withdrawn?.[0]?.element?.text}
                                />
                            ),
                        },
                    ]}
                />
            </aside>
            <section className="w-full flex flex-col">
                <SecurityForm
                    requirement={requirement}
                    initialState={initialState}
                    setInitialState={setInitialState}
                    isHydrating={isHydrating}
                    setStatuses={setStatuses}
                    prev={prev}
                    next={next}
                    groupings={groupings}
                    locked={locked}
                />
            </section>
        </>
    );
};
