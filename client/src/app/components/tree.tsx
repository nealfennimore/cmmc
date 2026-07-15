"use client";
import type { ElementWrapper, Manifest } from "@/api/entities/Framework";
import { useManifestContext } from "@/app/context/manifest";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { isLockedFamily, isLockedRequirement } from "@/app/utils/tier";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { FamilyEvidence, useFamilyEvidence } from "../hooks/evidence";
import { FamilyStatus, useFamilyStatus } from "../hooks/status";
import { EvidenceState } from "./evidence";
import { StatusState } from "./status";
import { IconLock } from "./icons";

export const Dropdown = ({ isOpen }: { isOpen: boolean }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className={isOpen ? "rotate-180" : "rotate-0"}
    >
        <path
            fill="#fff"
            fillRule="evenodd"
            d="M12.707 14.707a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 1.414-1.414L12 12.586l4.293-4.293a1 1 0 1 1 1.414 1.414z"
            clipRule="evenodd"
        />
    </svg>
);

export const FamilyBranch = ({
    family,
    manifest,
}: {
    family: ElementWrapper;
    manifest: Manifest;
}) => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const familyStatus = useFamilyStatus(family.element_identifier);
    const familyEvidence = useFamilyEvidence(family.element_identifier);
    const [isOpen, setOpen] = useState(false);
    const requirements = manifest.requirements.byFamily[
        family.element_identifier
    ].map((r) => r.element_identifier);
    return (
        <li className="mb-1" key={family.element_identifier}>
            <div className="flex items-center">
                <Link
                    className="grow hover:underline"
                    href={`${path}/family/${family.element_identifier}`}
                >
                    {family.element_identifier}: {family.title}
                </Link>
                {isLockedFamily(requirements) && (
                    <span
                        className="ms-1 text-xs text-amber-200"
                        title="Available in the desktop app"
                    >
                        <IconLock />
                    </span>
                )}
                <StatusState status={familyStatus?.status} size="sm" />
                <EvidenceState
                    evidence={familyEvidence?.hasEvidence}
                    size="sm"
                />
                <button
                    className="ml-2 w-[24px] h-[24px]"
                    onClick={() => setOpen(!isOpen)}
                >
                    <Dropdown isOpen={isOpen} />
                </button>
            </div>
            {isOpen && (
                <RequirementsLeaf
                    family={family}
                    manifest={manifest}
                    familyStatus={familyStatus}
                    familyEvidence={familyEvidence}
                />
            )}
        </li>
    );
};

export const RequirementsLeaf = ({
    family,
    manifest,
    familyStatus,
    familyEvidence,
}: {
    family: ElementWrapper;
    manifest: Manifest;
    familyStatus?: FamilyStatus;
    familyEvidence?: FamilyEvidence;
}) => {
    const requirements =
        manifest.requirements.byFamily[family.element_identifier];
    return (
        <ol className="ml-4 mt-2 mb-4">
            {requirements.map((requirement) => (
                <RequirementLeaf
                    key={requirement.element_identifier}
                    requirement={requirement}
                    familyStatus={familyStatus}
                    familyEvidence={familyEvidence}
                />
            ))}
        </ol>
    );
};
export const RequirementLeaf = ({
    requirement,
    familyStatus,
    familyEvidence,
}: {
    requirement: ElementWrapper;
    familyStatus?: FamilyStatus;
    familyEvidence?: FamilyEvidence;
}) => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const status = familyStatus?.requirementStatus(
        requirement.element_identifier,
    );
    const evidence = familyEvidence?.requirementEvidence(
        requirement.element_identifier,
    );
    const className = !requirement.title ? "line-through" : "";
    return (
        <li
            className={`mb-1 text-wrap ${className}`}
            key={requirement.element_identifier}
        >
            <span className="flex justify-between items-center">
                <Link
                    className="hover:underline"
                    href={`${path}/requirement/${requirement.element_identifier}`}
                >
                    {requirement.element_identifier}:{" "}
                    {requirement.title || "Withdrawn"}
                </Link>
                <span className="flex items-center">
                    {isLockedRequirement(requirement.element_identifier) && (
                        <span
                            className="ms-1 text-xs text-amber-200"
                            title="Available in the desktop app"
                        >
                            <IconLock />
                        </span>
                    )}
                    <StatusState status={status} size="xs" />
                    <EvidenceState evidence={evidence} size="xs" />
                </span>
            </span>
        </li>
    );
};

export const Tree = ({
    isOpen,
    setOpen,
}: {
    isOpen: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
}) => {
    const manifest = useManifestContext();
    const families = manifest.families.elements;

    return (
        <div
            id="drawer-contact"
            className={`fixed right-0 top-0 z-40 h-screen w-full overflow-y-auto bg-slate-900 p-4 text-slate-100 transition-transform md:max-w-md md:border-l md:border-slate-800 ${
                !isOpen ? "translate-x-full" : ""
            }`}
            tabIndex={-1}
            aria-labelledby="drawer-contact-label"
        >
            <h5
                id="drawer-left-label"
                className="mb-4 inline-flex items-center text-base font-semibold text-slate-400"
            >
                Overview
            </h5>
            <button
                type="button"
                data-drawer-hide="drawer-left-example"
                aria-controls="drawer-left-example"
                className="absolute end-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpen(false)}
            >
                <svg
                    className="w-3 h-3"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 14 14"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                    />
                </svg>
                <span className="sr-only">Close menu</span>
            </button>
            <ol className="flex flex-col">
                {families.map((family) => (
                    <FamilyBranch
                        key={family.element_identifier}
                        family={family}
                        manifest={manifest}
                    />
                ))}
            </ol>
        </div>
    );
};
