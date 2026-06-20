"use client";
import { SecurityRequirementValue } from "@/api/entities/RequirementValues";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { renderNumber } from "@/app/utils/number";
import Link from "next/link";
import { AssessmentGuidance } from "../assessment_guidance";
import { Breadcrumbs } from "../breadcrumbs";
import { DataTable } from "../datatable";
import { EvidenceState } from "../evidence";
import { IconInfo } from "../icon_info";
import { Popover } from "../popover";
import { StatusState } from "../status";
import { Heading } from "../ui";
import { SecurityForm } from "./security_form";

const re = new RegExp(/\d{1,2}\.\d{1,2}\.\d{1,2}/, "gm");
const linkify = (str: string) =>
    str.replaceAll(re, (match) => `<a href="#?element=${match}">${match}</a>`);

export const SecurityRequirement = ({
    groupings,
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
    evidence,
}: {
    value: SecurityRequirementValue;
}) => {
    const revision = useRevisionContext();
    const discussion =
        manifest.discussions.byRequirements[requirementId]?.[0]?.text || "";
    return (
        <>
            <Breadcrumbs requirementId={requirementId} />
            <Heading
                level={2}
                as="h3"
                className="mt-6 flex flex-wrap items-center gap-2"
            >
                Security Requirements for {requirement.requirement}{" "}
                {requirement.title}
                <StatusState statuses={statuses} />
                <EvidenceState evidence={evidence} />
            </Heading>
            <p
                className="discussion text-base leading-relaxed"
                dangerouslySetInnerHTML={{
                    __html:
                        revision === Revision.V2
                            ? linkify(discussion)
                            : discussion,
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
                                        popoverTarget="poamable-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">POAMable</span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="poamable-popover">
                                        <IconInfo />
                                        <span>
                                            A security requirement can only be
                                            used in the POA&M when it has a
                                            value of 1. The only exception is
                                            03.13.11 wherein encryption is used
                                            but not FIPS-validated. If the
                                            requirement is not met and cannot be
                                            POA&M-ed then you cannot achieve
                                            CMMC L2 certification.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible: !!value?.value,
                            value:
                                value?.value === 1 ||
                                requirementId === "03.13.11"
                                    ? "Yes"
                                    : "No",
                        },
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
                            visible:
                                revision === Revision.V3 &&
                                !!value?.revision?.length,
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
                                        popoverTarget="deprecated-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">Deprecates</span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="deprecated-popover">
                                        <IconInfo />
                                        <span>
                                            This security requirement
                                            incorporates the following controls
                                            from revision 2.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible:
                                revision === Revision.V3 &&
                                !!value?.withdrawn_from?.length,
                            className: "hidden md:inline",
                            value: value?.withdrawn_from?.map((id) => (
                                <Link
                                    key={id}
                                    href={`/r2/requirement/${id}`}
                                    className="mr-2 text-xs text-primary hover:underline"
                                >
                                    {id}
                                </Link>
                            )),
                        },
                        {
                            title: (
                                <>
                                    <button
                                        popoverTarget="deprecated-value-popover"
                                        className="uppercase flex items-center"
                                    >
                                        <span className="mr-2">
                                            Deprecated Value
                                        </span>{" "}
                                        <IconInfo />
                                    </button>
                                    <Popover id="deprecated-value-popover">
                                        <IconInfo />
                                        <span>
                                            This is the aggregate value of all
                                            controls this security requirement
                                            has incorporated. It is an estimate
                                            until CMMC is updated to use 800-171
                                            revision 3.
                                        </span>
                                    </Popover>
                                </>
                            ),
                            visible:
                                revision === Revision.V3 &&
                                !!value?.withdrawn_from?.length,
                            value: renderNumber(
                                value?.aggregate_value_withdrawn_from,
                            ),
                        },
                    ]}
                />
            </aside>
            <AssessmentGuidance requirementId={requirementId} />
            <section className="w-full flex flex-col">
                <SecurityForm
                    requirement={requirement}
                    groupings={groupings}
                    initialState={initialState}
                    setInitialState={setInitialState}
                    isHydrating={isHydrating}
                    setStatuses={setStatuses}
                    prev={prev}
                    next={next}
                />
            </section>
        </>
    );
};
