"use client";
import { viewFile } from "@/app/components/security_requirements/utils";
import { IDBEvidenceV2 } from "@/app/db";
import { embeddable, snippetable } from "@/app/utils/file";
import { openExternal, openFileInSystemViewer } from "@/app/utils/tauri";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModalShell } from "./confirm";
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

// Hover preview for image and text artifacts, anchored like the hash
// tooltip: opens upward so it stays inside the evidence table's scroll
// container. Mounted only while hovered so object URLs are created lazily
// and revoked on leave. Being absolutely positioned it also escapes the
// badge's hover underline (text-decoration does not propagate out of flow).
const PreviewCard = ({
    artifact,
    onExpand,
}: {
    artifact: IDBEvidenceV2;
    onExpand: () => void;
}) => {
    const isImg = embeddable(artifact);
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!isImg) {
            return;
        }
        const url = URL.createObjectURL(
            new Blob([artifact.data], { type: artifact.type }),
        );
        setImageSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [artifact, isImg]);

    // A truncated slice can split a multibyte character; TextDecoder swaps
    // in a replacement character, which is fine for a preview.
    const snippet = isImg
        ? null
        : new TextDecoder().decode(artifact.data.slice(0, 500));

    return (
        <span
            // Inside the badge <button>: without stopPropagation, clicking
            // the card would bubble up and open the file instead.
            onClick={(e) => {
                e.stopPropagation();
                onExpand();
            }}
            title="Click to expand"
            className="absolute bottom-[calc(100%-10px)] left-0 z-10 mb-2 flex w-max max-w-72 cursor-zoom-in flex-col gap-1 rounded-md border border-border bg-card p-2 text-left shadow-md"
        >
            {isImg ? (
                imageSrc && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={imageSrc}
                        alt={artifact.filename}
                        className="max-h-48 max-w-full rounded object-contain"
                    />
                )
            ) : (
                <span className="block max-h-48 overflow-hidden whitespace-pre-wrap break-all font-mono text-xs font-normal text-foreground">
                    {snippet}
                </span>
            )}
            <span className="text-xs font-normal text-muted-foreground">
                {artifact.data.byteLength} bytes | {artifact.type}
            </span>
        </span>
    );
};

// Full-size preview modal, opened by clicking the hover card. Portaled to
// <body> so the dialog markup escapes the badge <button>; the wrapper stops
// click propagation because portaled events still bubble through the React
// tree — without it, closing via the backdrop would open the file.
const ExpandedPreview = ({
    artifact,
    onClose,
}: {
    artifact: IDBEvidenceV2;
    onClose: () => void;
}) => {
    const isImg = embeddable(artifact);
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!isImg) {
            return;
        }
        const url = URL.createObjectURL(
            new Blob([artifact.data], { type: artifact.type }),
        );
        setImageSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [artifact, isImg]);

    const text = isImg ? null : new TextDecoder().decode(artifact.data);

    return createPortal(
        <span
            onClick={(e) => e.stopPropagation()}
            className="cursor-default whitespace-normal text-left font-normal normal-case"
        >
            <ModalShell
                ariaLabel={artifact.filename}
                onDismiss={onClose}
                panelClassName="max-w-7xl"
            >
                {() => (
                    <div className="px-6 py-5">
                        <h2 className="truncate pr-8 text-lg font-semibold tracking-tight">
                            {artifact.filename}
                        </h2>
                        <div className="mt-3 flex max-h-[80vh] justify-center overflow-auto">
                            {isImg ? (
                                imageSrc && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={imageSrc}
                                        alt={artifact.filename}
                                        className="rounded object-contain"
                                    />
                                )
                            ) : (
                                <pre className="w-full whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                                    {text}
                                </pre>
                            )}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                            {artifact.data.byteLength} bytes | {artifact.type}
                        </p>
                    </div>
                )}
            </ModalShell>
        </span>,
        document.body,
    );
};

export const FileBadge = ({
    artifact,
    hideIcon,
    className = "text-primary hover:underline",
}: {
    artifact: IDBEvidenceV2;
    hideIcon?: boolean;
    className?: string;
}) => {
    const previewable = embeddable(artifact) || snippetable(artifact);
    const [showPreview, setShowPreview] = useState(false);
    const [expanded, setExpanded] = useState(false);

    return (
        <button
            className={`relative flex items-center pr-2 ${className}`}
            // The rich preview replaces the native tooltip; keep the latter
            // for types we can't render (pdf, archives, ...).
            title={
                previewable
                    ? undefined
                    : `${artifact.data.byteLength} bytes | ${artifact.type}`
            }
            onMouseEnter={() => previewable && setShowPreview(true)}
            onMouseLeave={() => setShowPreview(false)}
            onFocus={() => previewable && setShowPreview(true)}
            onBlur={() => setShowPreview(false)}
            onClick={async () => {
                // In the desktop shell, open via the OS default app; the blob
                // URL in viewFile is the browser fallback.
                if (
                    await openFileInSystemViewer(
                        artifact.filename,
                        artifact.data,
                    )
                ) {
                    return;
                }
                viewFile(artifact);
            }}
        >
            {!hideIcon && <IconFileDownload />}
            <span>{artifact.filename}</span>
            {showPreview && !expanded && (
                <PreviewCard
                    artifact={artifact}
                    onExpand={() => setExpanded(true)}
                />
            )}
            {expanded && (
                <ExpandedPreview
                    artifact={artifact}
                    // Also clear the hover state: the badge often still has
                    // focus (and may sit under the pointer) when the modal
                    // closes, which would pop the card right back open.
                    onClose={() => {
                        setExpanded(false);
                        setShowPreview(false);
                    }}
                />
            )}
        </button>
    );
};
export const LinkBadge = ({
    artifact,
    hideIcon,
    className = "text-primary hover:underline",
}: {
    artifact: IDBEvidenceV2;
    hideIcon?: boolean;
    className?: string;
}) => {
    const url = new TextDecoder().decode(artifact.data);

    const onClick = async () => {
        // In the desktop shell this opens the system browser; the detached
        // anchor below is the browser fallback.
        if (await openExternal(url)) {
            return;
        }
        Object.assign(document.createElement("a"), {
            target: "_blank",
            rel: "noopener noreferrer",
            href: url,
        }).click();
    };

    return (
        <button
            className={`flex items-center pr-2 ${className}`}
            title={`${url}`}
            onClick={onClick}
        >
            {!hideIcon && <IconExternal />}
            <span>{artifact.filename}</span>
        </button>
    );
};
