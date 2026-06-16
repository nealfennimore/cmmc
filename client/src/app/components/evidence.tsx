"use client";
import { viewFile } from "@/app/components/security_requirements/utils";
import { IDBEvidenceV2 } from "@/app/db";
import { toSizeClass } from "./status";

interface EvidenceStateProps {
    evidence?: boolean[] | boolean;
    size?: string;
}

const EvidenceSpan = ({
    evidence,
    size = "xl",
}: {
    evidence: boolean;
    size?: string;
}) => {
    return (
        evidence && (
            <span
                className={`${toSizeClass(size)} text-muted-foreground mx-2`}
                title="Has evidence"
            >
                🧾
            </span>
        )
    );
};

export const EvidenceState = ({ evidence, size }: EvidenceStateProps) => {
    if (evidence?.length) {
        return (
            <EvidenceSpan
                evidence={(evidence as boolean[])?.every((b) => b)}
                size={size}
            />
        );
    }
    return <EvidenceSpan evidence={evidence as boolean} size={size} />;
};

const IconFileDownload = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20 12.5V6.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C17.72 2 16.88 2 15.2 2H8.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C4 4.28 4 5.12 4 6.8v10.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C6.28 22 7.12 22 8.8 22h3.7m2.5-3 3 3m0 0 3-3m-3 3v-6"
        />
    </svg>
);

const IconExternal = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 9V3m0 0h-6m6 0-8 8m-3-6H7.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C3 7.28 3 8.12 3 9.8v6.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C5.28 21 6.12 21 7.8 21h6.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C19 18.72 19 17.88 19 16.2V14"
        />
    </svg>
);

export const FileBadge = ({
    artifact,
    hideIcon,
}: {
    artifact: IDBEvidenceV2;
    hideIcon?: boolean;
}) => {
    return (
        <button
            className="flex items-center pr-2 text-primary hover:underline"
            title={`${artifact.data.byteLength} bytes | ${artifact.type}`}
            onClick={() => viewFile(artifact)}
        >
            {!hideIcon && <IconFileDownload />}
            <span>{artifact.filename}</span>
        </button>
    );
};
export const LinkBadge = ({
    artifact,
    hideIcon,
}: {
    artifact: IDBEvidenceV2;
    hideIcon?: boolean;
}) => {
    const url = new TextDecoder().decode(artifact.data);

    const onClick = async () => {
        Object.assign(document.createElement("a"), {
            target: "_blank",
            rel: "noopener noreferrer",
            href: url,
        }).click();
    };

    return (
        <button
            className="flex items-center pr-2 text-primary hover:underline"
            title={`${url}`}
            onClick={onClick}
        >
            {!hideIcon && <IconExternal />}
            <span>{artifact.filename}</span>
        </button>
    );
};
