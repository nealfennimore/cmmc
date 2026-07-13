"use client";
import { viewFile } from "@/app/components/security_requirements/utils";
import { IDBEvidenceV2 } from "@/app/db";
import { useHoverCard } from "@/app/hooks/hoverCard";
import {
    embeddable,
    isCode,
    isCSV,
    isDoc,
    isImage,
    isMusic,
    isPDF,
    isPowerpoint,
    isVideo,
    isWord,
    isZip,
    mimeLabel,
    snippetable,
} from "@/app/utils/file";
import { openExternal, openFileInSystemViewer } from "@/app/utils/tauri";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
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

const IconFileImage = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            fill="currentColor"
            d="M16 18H8l2.5-6 2 4 1.5-2zm-1-8.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"
        />
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1M8 18h8l-2-4-1.5 2-2-4zm7-8.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"
        />
    </svg>
);

const IconFileZip = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Zm-4 1h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13z"
        />
    </svg>
);
const IconFileWord = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m4 4 1 5 2-3.333L14 17l1-5m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1"
        />
    </svg>
);
const IconFileVideo = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1ZM9 12h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Zm5.697 2.395v-.733l1.269-1.219v2.984l-1.268-1.032Z"
        />
    </svg>
);

const IconFilePowerpoint = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 17v-5h1.5a1.5 1.5 0 1 1 0 3H5m6 2v-5h1.5a1.5 1.5 0 1 1 0 3H11m7-3v5m-1-5h2M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5"
        />
    </svg>
);
const IconFilePDF = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 17v-5h1.5a1.5 1.5 0 1 1 0 3H5m12 2v-5h2m-2 3h2M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m6 4v5h1.375A1.627 1.627 0 0 0 14 15.375v-1.75A1.627 1.627 0 0 0 12.375 12z"
        />
    </svg>
);
const IconFileMusic = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m8 7.5V8s3 1 3 4m3-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1m-6 12c0 1.105-1.12 2-2.5 2S8 17.105 8 16s1.12-2 2.5-2 2.5.895 2.5 2"
        />
    </svg>
);
const IconFileDoc = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m14 9.006h-.335a1.647 1.647 0 0 1-1.647-1.647v-1.706a1.647 1.647 0 0 1 1.647-1.647L19 12M5 12v5h1.375A1.626 1.626 0 0 0 8 15.375v-1.75A1.626 1.626 0 0 0 6.375 12zm9 1.5v2a1.5 1.5 0 0 1-1.5 1.5v0a1.5 1.5 0 0 1-1.5-1.5v-2a1.5 1.5 0 0 1 1.5-1.5v0a1.5 1.5 0 0 1 1.5 1.5"
        />
    </svg>
);
const IconFileCSV = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m2.665 9H6.647A1.647 1.647 0 0 1 5 15.353v-1.706A1.647 1.647 0 0 1 6.647 12h1.018M16 12l1.443 4.773L19 12m-6.057-.152-.943-.02a1.34 1.34 0 0 0-1.359 1.22 1.32 1.32 0 0 0 1.172 1.421l.536.059a1.273 1.273 0 0 1 1.226 1.718c-.2.571-.636.754-1.337.754h-1.13"
        />
    </svg>
);
const IconFileCode = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m5 4-2 2 2 2m4-4 2 2-2 2m5-12v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1"
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
const IconLink = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13.213 9.787a3.391 3.391 0 0 0-4.795 0l-3.425 3.426a3.39 3.39 0 0 0 4.795 4.794l.321-.304m-.321-4.49a3.39 3.39 0 0 0 4.795 0l3.424-3.426a3.39 3.39 0 0 0-4.794-4.795l-1.028.961"
        />
    </svg>
);

// pdf.js is ~1MB, so it loads on demand the first time a PDF preview renders.
// The worker is emitted by the bundler as a local asset (never a CDN fetch —
// evidence must not leave the machine).
let pdfjsLoader: Promise<typeof import("pdfjs-dist")> | undefined;
const loadPdfjs = () => {
    if (!pdfjsLoader) {
        pdfjsLoader = import("pdfjs-dist").then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url,
            ).toString();
            return pdfjs;
        });
    }
    return pdfjsLoader;
};

/**
 * Renders a PDF's pages to stacked canvases. Pages lay out at `width` CSS
 * pixels (the backing store scales by devicePixelRatio for sharpness); the
 * hover card caps at the first page via `maxPages`, the expanded modal
 * renders them all.
 */
const PdfPages = ({
    artifact,
    width,
    maxPages,
}: {
    artifact: IDBEvidenceV2;
    width: number;
    maxPages?: number;
}) => {
    const containerRef = useRef<HTMLSpanElement>(null);
    const [state, setState] = useState<"loading" | "ready" | "error">(
        "loading",
    );

    useEffect(() => {
        let cancelled = false;
        let task: PDFDocumentLoadingTask | undefined;
        (async () => {
            try {
                const pdfjs = await loadPdfjs();
                // pdf.js transfers the buffer to its worker, which would
                // detach the artifact's in-memory bytes — hand it a copy.
                task = pdfjs.getDocument({ data: artifact.data.slice(0) });
                const doc = await task.promise;
                const total = Math.min(
                    doc.numPages,
                    maxPages ?? doc.numPages,
                );
                for (let i = 1; i <= total; i++) {
                    if (cancelled) {
                        return;
                    }
                    const page = await doc.getPage(i);
                    const dpr = window.devicePixelRatio || 1;
                    const scale =
                        (width / page.getViewport({ scale: 1 }).width) * dpr;
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement("canvas");
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    canvas.className = "w-full rounded border border-border";
                    await page.render({
                        canvas,
                        canvasContext: canvas.getContext("2d")!,
                        viewport,
                    }).promise;
                    if (cancelled) {
                        return;
                    }
                    // Canvases append imperatively (they are not React
                    // children); the status span below is React's own first
                    // child, so removing it on "ready" stays safe.
                    containerRef.current?.appendChild(canvas);
                    setState("ready");
                }
            } catch {
                if (!cancelled) {
                    setState("error");
                }
            }
        })();
        return () => {
            cancelled = true;
            task?.destroy();
        };
    }, [artifact, width, maxPages]);

    return (
        <span
            ref={containerRef}
            style={{ maxWidth: width }}
            className="mx-auto flex w-full flex-col gap-2"
        >
            {state !== "ready" && (
                <span className="text-xs font-normal text-muted-foreground">
                    {state === "loading"
                        ? "Loading preview…"
                        : "Preview unavailable."}
                </span>
            )}
        </span>
    );
};

// Hover preview for image, PDF, and text artifacts, portaled to <body> at a
// fixed position so the evidence table's scroll container can't clip it (and
// the badge's hover underline can't reach it). Mounted only while hovered so
// object URLs are created lazily and revoked on leave. Portaled events still
// bubble through the React tree, so the badge's own handlers see the card's
// clicks unless stopped.
const PreviewCard = ({
    artifact,
    position,
    onExpand,
    onMouseEnter,
    onMouseLeave,
}: {
    artifact: IDBEvidenceV2;
    position: { top: number; left: number };
    onExpand: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}) => {
    const isImg = embeddable(artifact);
    const isPdf = isPDF(artifact.type);
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
    const snippet =
        isImg || isPdf
            ? null
            : new TextDecoder().decode(artifact.data.slice(0, 500));

    return createPortal(
        <span
            // React-tree child of the badge <button>: without stopPropagation,
            // clicking the card would bubble up and open the file instead.
            onClick={(e) => {
                e.stopPropagation();
                onExpand();
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            title="Click to expand"
            style={position}
            className="fixed z-50 flex w-max max-w-72 -translate-y-full cursor-zoom-in flex-col gap-1 rounded-md border border-border bg-card p-2 text-left font-normal normal-case shadow-md"
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
            ) : isPdf ? (
                <span className="block max-h-48 w-64 overflow-hidden">
                    <PdfPages artifact={artifact} width={256} maxPages={1} />
                </span>
            ) : (
                <span className="block max-h-48 overflow-hidden whitespace-pre-wrap break-all font-mono text-xs font-normal text-foreground">
                    {snippet}
                </span>
            )}
            <span
                className="text-xs font-normal text-muted-foreground"
                title={artifact.type}
            >
                {artifact.data.byteLength} bytes | {mimeLabel(artifact.type)}
            </span>
        </span>,
        document.body,
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
    const isPdf = isPDF(artifact.type);
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

    const text =
        isImg || isPdf ? null : new TextDecoder().decode(artifact.data);

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
                            ) : isPdf ? (
                                <PdfPages artifact={artifact} width={960} />
                            ) : (
                                <pre className="w-full whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                                    {text}
                                </pre>
                            )}
                        </div>
                        <p
                            className="mt-3 text-xs text-muted-foreground"
                            title={artifact.type}
                        >
                            {artifact.data.byteLength} bytes |{" "}
                            {mimeLabel(artifact.type)}
                        </p>
                    </div>
                )}
            </ModalShell>
        </span>,
        document.body,
    );
};

const getIcon = (type: string): JSX.Element => {
    if (isImage(type)) {
        return <IconFileImage />;
    }
    if (isPDF(type)) {
        return <IconFilePDF />;
    }
    if (isWord(type)) {
        return <IconFileWord />;
    }
    if (isPowerpoint(type)) {
        return <IconFilePowerpoint />;
    }
    if (isCSV(type)) {
        return <IconFileCSV />;
    }
    if (isCode(type)) {
        return <IconFileCode />;
    }
    if (isDoc(type)) {
        return <IconFileDoc />;
    }
    if (isMusic(type)) {
        return <IconFileMusic />;
    }
    if (isVideo(type)) {
        return <IconFileVideo />;
    }
    if (isZip(type)) {
        return <IconFileZip />;
    }
    return <IconFileDownload />;
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
    const previewable =
        embeddable(artifact) ||
        snippetable(artifact) ||
        isPDF(artifact.type);
    const preview = useHoverCard();
    const [expanded, setExpanded] = useState(false);
    const Icon = getIcon(artifact.type);

    return (
        <button
            className={`relative flex items-center pr-2 ${className}`}
            // The rich preview replaces the native tooltip; keep the latter
            // for types we can't render (pdf, archives, ...).
            title={
                previewable
                    ? undefined
                    : `${artifact.data.byteLength} bytes | ${mimeLabel(artifact.type)}`
            }
            onMouseEnter={(e) => previewable && preview.show(e.currentTarget)}
            onMouseLeave={preview.scheduleHide}
            onFocus={(e) => previewable && preview.show(e.currentTarget)}
            onBlur={preview.scheduleHide}
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
            {!hideIcon && Icon}
            <span>{artifact.filename}</span>
            {preview.position && !expanded && (
                <PreviewCard
                    artifact={artifact}
                    position={preview.position}
                    onExpand={() => setExpanded(true)}
                    onMouseEnter={preview.cancelHide}
                    onMouseLeave={preview.scheduleHide}
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
                        preview.hide();
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
            {!hideIcon && <IconLink />}
            <span>{artifact.filename}</span>
        </button>
    );
};
