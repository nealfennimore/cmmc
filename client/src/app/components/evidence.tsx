"use client";
import { getIcon, IconLink } from "@/app/components/file_icons";
import {
    IconChevronLeft,
    IconChevronRight,
    IconPaperclip,
} from "@/app/components/icons";
import { viewFile } from "@/app/components/security_requirements/utils";
import { IDB, IDBEvidenceV2 } from "@/app/db";
import { useHoverCard } from "@/app/hooks/hoverCard";
import {
    embeddable,
    formatBytes,
    isDocx,
    isOpenDocument,
    isPDF,
    isPptx,
    isRTF,
    mimeLabel,
    snippetable,
} from "@/app/utils/file";
import { loadPdfjs } from "@/app/utils/pdf";
import { Sheet, loadSheets, sheetKind } from "@/app/utils/sheets";
import { openExternal, openFileInSystemViewer } from "@/app/utils/tauri";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModalShell } from "./confirm";
import { toSizeClass, toIconSizeClass } from "./status";

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
                className={`${toSizeClass(size)} text-muted-foreground mr-2`}
                title="Has evidence"
            >
                <IconPaperclip className={toIconSizeClass(size)} />
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

// Formats the browser can't render but the search extractor already reads
// (office documents) — previewed via their stored extracted text instead.
const hasExtractedPreview = (artifact: IDBEvidenceV2) =>
    isDocx(artifact.type) ||
    isPptx(artifact.type) ||
    isOpenDocument(artifact.type) ||
    isRTF(artifact.type);

/**
 * Plain-text preview for office documents, read from the evidence_text store
 * the search extractor maintains. No layout — it answers "is this the right
 * document?", not "what does it look like?". Unavailable until the idle
 * extractor has processed the file (or when extraction failed).
 */
const ExtractedTextPreview = ({
    artifact,
    maxChars,
    className,
}: {
    artifact: IDBEvidenceV2;
    /** Cap for the hover card; omit for the full text in the modal. */
    maxChars?: number;
    className?: string;
}) => {
    const [state, setState] = useState<"loading" | "ready" | "missing">(
        "loading",
    );
    const [text, setText] = useState("");

    useEffect(() => {
        let active = true;
        setState("loading");
        IDB.evidenceText
            .getAll(IDBKeyRange.only(artifact.id))
            .then(([row]) => {
                if (!active) {
                    return;
                }
                if (row?.status === "ok" && row.text.trim()) {
                    setText(
                        maxChars ? row.text.slice(0, maxChars) : row.text,
                    );
                    setState("ready");
                } else {
                    setState("missing");
                }
            })
            .catch(() => active && setState("missing"));
        return () => {
            active = false;
        };
    }, [artifact, maxChars]);

    if (state !== "ready") {
        return (
            <span className="text-xs font-normal text-muted-foreground">
                {state === "loading"
                    ? "Loading preview…"
                    : "Preview unavailable."}
            </span>
        );
    }
    return <span className={className}>{text}</span>;
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
                const total = Math.min(doc.numPages, maxPages ?? doc.numPages);
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
    const isSheet = sheetKind(artifact) !== null;
    const isOffice = hasExtractedPreview(artifact);
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
        isImg || isPdf || isSheet || isOffice
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
            ) : isSheet ? (
                <span className="block max-h-48 overflow-hidden">
                    <SheetPreview
                        artifact={artifact}
                        maxRows={10}
                        firstSheetOnly
                    />
                </span>
            ) : isOffice ? (
                <>
                    <span className="block max-h-48 w-64 overflow-hidden whitespace-pre-wrap break-words text-xs font-normal text-foreground">
                        <ExtractedTextPreview
                            artifact={artifact}
                            maxChars={500}
                        />
                    </span>
                    <span className="text-xs font-normal italic text-muted-foreground">
                        Extracted text only — click the file name to open the
                        document.
                    </span>
                </>
            ) : (
                <span className="block max-h-48 overflow-hidden whitespace-pre-wrap break-all font-mono text-xs font-normal text-foreground">
                    {snippet}
                </span>
            )}
            <span
                className="text-xs font-normal text-muted-foreground"
                title={artifact.type}
            >
                {formatBytes(artifact.data.byteLength)} |{" "}
                {mimeLabel(artifact.type)}
            </span>
        </span>,
        document.body,
    );
};

const SHEET_PREVIEW_MAX_ROWS = 500;
const SHEET_PREVIEW_MAX_COLS = 20;

const SheetTable = ({
    rows,
    maxRows = SHEET_PREVIEW_MAX_ROWS,
}: {
    rows: string[][];
    maxRows?: number;
}) => {
    const shown = rows.slice(0, maxRows);
    const clippedCols = rows.some((row) => row.length > SHEET_PREVIEW_MAX_COLS);
    return (
        <span className="flex flex-col gap-1">
            <table className="w-max border-collapse text-xs font-normal text-foreground">
                <tbody>
                    {shown.map((row, rowIndex) => (
                        <tr
                            key={rowIndex}
                            className={
                                rowIndex === 0 ? "bg-secondary font-medium" : ""
                            }
                        >
                            {row
                                .slice(0, SHEET_PREVIEW_MAX_COLS)
                                .map((cell, colIndex) => (
                                    <td
                                        key={colIndex}
                                        className="max-w-48 overflow-hidden text-ellipsis whitespace-nowrap border border-border px-2 py-1"
                                    >
                                        {cell}
                                    </td>
                                ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {(rows.length > maxRows || clippedCols) && (
                <span className="text-xs font-normal text-muted-foreground">
                    Preview truncated ({rows.length} rows).
                </span>
            )}
        </span>
    );
};

/** CSV/.xlsx preview: each worksheet as a table (CSV is one nameless sheet). */
const SheetPreview = ({
    artifact,
    maxRows,
    firstSheetOnly,
}: {
    artifact: IDBEvidenceV2;
    maxRows?: number;
    firstSheetOnly?: boolean;
}) => {
    const [sheets, setSheets] = useState<Sheet[] | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        loadSheets(artifact)
            .then((loaded) => active && setSheets(loaded))
            .catch(() => active && setError(true));
        return () => {
            active = false;
        };
    }, [artifact]);

    if (error) {
        return (
            <span className="text-xs font-normal text-muted-foreground">
                Preview unavailable.
            </span>
        );
    }
    if (!sheets) {
        return (
            <span className="text-xs font-normal text-muted-foreground">
                Loading preview…
            </span>
        );
    }

    const shown = firstSheetOnly ? sheets.slice(0, 1) : sheets;
    return (
        <span className="flex w-full flex-col gap-3">
            {shown.map((sheet, index) => (
                <span key={index} className="flex flex-col gap-1">
                    {sheet.name && sheets.length > 1 && (
                        <span className="text-xs font-medium text-muted-foreground">
                            {sheet.name}
                        </span>
                    )}
                    <SheetTable rows={sheet.rows} maxRows={maxRows} />
                </span>
            ))}
        </span>
    );
};

// Artifacts the previews can render (URL evidence and types like zip are
// excluded). Office documents preview as their extracted text.
const isPreviewable = (artifact: IDBEvidenceV2) =>
    embeddable(artifact) ||
    snippetable(artifact) ||
    isPDF(artifact.type) ||
    sheetKind(artifact) !== null ||
    hasExtractedPreview(artifact);

// Full-size preview modal, opened by clicking the hover card. Portaled to
// <body> so the dialog markup escapes the badge <button>; the wrapper stops
// click propagation because portaled events still bubble through the React
// tree — without it, closing via the backdrop would open the file.
//
// With `artifacts` (the previewable siblings in the current context), header
// arrows and the ←/→ keys page through the evidence for review without
// closing the modal.
const ExpandedPreview = ({
    artifact,
    artifacts,
    onClose,
}: {
    artifact: IDBEvidenceV2;
    artifacts?: IDBEvidenceV2[];
    onClose: () => void;
}) => {
    const list = artifacts?.length ? artifacts : [artifact];
    const [index, setIndex] = useState(() => {
        const at = list.findIndex((entry) => entry.id === artifact.id);
        return at === -1 ? 0 : at;
    });
    const current = list[index] ?? artifact;
    const isImg = embeddable(current);
    const isPdf = isPDF(current.type);
    const isSheet = sheetKind(current) !== null;
    const isOffice = hasExtractedPreview(current);
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!isImg) {
            setImageSrc(null);
            return;
        }
        const url = URL.createObjectURL(
            new Blob([current.data], { type: current.type }),
        );
        setImageSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [current, isImg]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                setIndex((i) => Math.max(0, i - 1));
            }
            if (e.key === "ArrowRight") {
                setIndex((i) => Math.min(list.length - 1, i + 1));
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [list.length]);

    const text =
        isImg || isPdf || isSheet || isOffice
            ? null
            : new TextDecoder().decode(current.data);

    return createPortal(
        <span
            onClick={(e) => e.stopPropagation()}
            className="cursor-default whitespace-normal text-left font-normal normal-case"
        >
            <ModalShell
                ariaLabel={current.filename}
                onDismiss={onClose}
                panelClassName="max-w-7xl"
            >
                {() => (
                    <div className="px-6 py-5">
                        <div className="flex items-center gap-3 pr-8">
                            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                                {current.filename}
                            </h2>
                            {list.length > 1 && (
                                <span className="flex shrink-0 items-center gap-2 text-sm font-normal text-muted-foreground">
                                    <button
                                        type="button"
                                        aria-label="Previous evidence"
                                        disabled={index === 0}
                                        onClick={() =>
                                            setIndex((i) => Math.max(0, i - 1))
                                        }
                                        className="rounded-md border border-border p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <IconChevronLeft />
                                    </button>
                                    {index + 1} / {list.length}
                                    <button
                                        type="button"
                                        aria-label="Next evidence"
                                        disabled={index === list.length - 1}
                                        onClick={() =>
                                            setIndex((i) =>
                                                Math.min(
                                                    list.length - 1,
                                                    i + 1,
                                                ),
                                            )
                                        }
                                        className="rounded-md border border-border p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <IconChevronRight />
                                    </button>
                                </span>
                            )}
                        </div>
                        <div className="mt-3 flex max-h-[80vh] justify-center overflow-auto">
                            {isImg ? (
                                imageSrc && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={imageSrc}
                                        alt={current.filename}
                                        className="rounded object-contain"
                                    />
                                )
                            ) : isPdf ? (
                                // Keyed so navigating remounts the renderer —
                                // its canvases append imperatively and would
                                // otherwise pile up under the next document.
                                <PdfPages
                                    key={current.id}
                                    artifact={current}
                                    width={960}
                                />
                            ) : isSheet ? (
                                <SheetPreview artifact={current} />
                            ) : isOffice ? (
                                <ExtractedTextPreview
                                    artifact={current}
                                    className="block w-full max-w-3xl whitespace-pre-wrap break-words text-sm text-foreground"
                                />
                            ) : (
                                <pre className="w-full whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                                    {text}
                                </pre>
                            )}
                        </div>
                        {isOffice && (
                            <p className="mt-3 text-xs italic text-muted-foreground">
                                Extracted text only — open the file from its
                                evidence link to view the original document
                                (opens in your system&apos;s viewer on
                                desktop).
                            </p>
                        )}
                        <p
                            className="mt-3 text-xs text-muted-foreground"
                            title={current.type}
                        >
                            {formatBytes(current.data.byteLength)} |{" "}
                            {mimeLabel(current.type)}
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
    siblings,
    hideIcon,
    className = "text-primary hover:underline",
}: {
    artifact: IDBEvidenceV2;
    /** Evidence in the same view; the expanded preview's arrows page through
     *  its previewable members. */
    siblings?: IDBEvidenceV2[];
    hideIcon?: boolean;
    className?: string;
}) => {
    const previewable = isPreviewable(artifact);
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
                    : `${formatBytes(artifact.data.byteLength)} | ${mimeLabel(artifact.type)}`
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
                    artifacts={siblings?.filter(isPreviewable)}
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
