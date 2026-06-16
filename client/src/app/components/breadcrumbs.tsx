"use client";
import { useManifestContext } from "@/app/context/manifest";
import { toPath, useRevisionContext } from "@/app/context/revision";
import Link from "next/link";
import { RevisionSwitch } from "./revision_switch";
import { TotalScore } from "./score";

interface BreadcrumbLink {
    href: string;
    text: string;
    disabled?: boolean;
}

interface BreadcrumbsProps {
    familyId?: string;
    requirementId?: string;
}

export const Breadcrumbs = ({ familyId, requirementId }: BreadcrumbsProps) => {
    const manifest = useManifestContext();
    const revision = useRevisionContext();
    const path = toPath(revision);

    const links: BreadcrumbLink[] = [
        {
            href: path,
            text: "Families",
        },
    ];

    if (familyId) {
        const family = manifest?.families?.byId[familyId];
        links.push({
            href: `${path}/family/${familyId}`,
            text: `${family.element_identifier}: ${family.title}`,
        });
    } else if (requirementId) {
        const requirement = manifest?.requirements?.byId[requirementId];
        const family = manifest?.families?.byId[requirement.family];
        links.push({
            href: `${path}/family/${requirement.family}`,
            text: `${family.element_identifier}: ${family.title}`,
        });
        links.push({
            href: `${path}/requirement/${requirementId}`,
            text: `${requirement.element_identifier}: ${requirement.title}`,
            disabled: true,
        });
    }

    return (
        <aside className="mx-auto flex w-full flex-wrap items-center justify-between gap-2">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center">
                {links.map((link, index) => (
                    <span key={index} className="flex items-center">
                        <Link
                            className="text-sm text-muted-foreground transition-colors hover:text-foreground aria-disabled:pointer-events-none aria-disabled:text-foreground"
                            href={link.href}
                            aria-disabled={link.disabled}
                            tabIndex={60}
                        >
                            {link.text}
                        </Link>
                        {index < links.length - 1 && (
                            <span className="mx-2 text-sm text-muted-foreground">
                                /
                            </span>
                        )}
                    </span>
                ))}
            </nav>
            <div className="flex items-center">
                <RevisionSwitch />
                <TotalScore />
            </div>
        </aside>
    );
};
