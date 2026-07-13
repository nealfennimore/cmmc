"use client";
import { getIcon, IconLink } from "@/app/components/file_icons";
import { viewFile } from "@/app/components/security_requirements/utils";
import { IDBEvidenceV2 } from "@/app/db";
import { useHoverCard } from "@/app/hooks/hoverCard";
import { parseCSV } from "@/app/utils/csv";
import {
    embeddable,
    formatBytes,
    isCSV,
    isExcel,
    isPDF,
    mimeLabel,
    snippetable,
} from "@/app/utils/file";
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

const IconQuestion = ({ className = "h-4 mr-1" }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className={className}
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 8v8a5 5 0 1 0 10 0V6.5a3.5 3.5 0 1 0-7 0V15a2 2 0 0 0 4 0V8"
        />
    </svg>
);

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
                <IconQuestion className={toIconSizeClass(size)} />
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
        isImg || isPdf || isSheet
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

interface Sheet {
    name?: string;
    rows: string[][];
}

// exceljs cell values can be rich objects (rich text runs, hyperlinks,
// formulas with cached results, dates) — flatten each to display text.
const cellText = (value: unknown): string => {
    if (value == null) {
        return "";
    }
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "object") {
        const cell = value as {
            richText?: { text: string }[];
            text?: unknown;
            result?: unknown;
        };
        if (cell.richText) {
            return cell.richText.map((run) => run.text).join("");
        }
        if (cell.text !== undefined) {
            return String(cell.text);
        }
        if (cell.result !== undefined) {
            return cellText(cell.result);
        }
        return "";
    }
    return String(value);
};

// Windows systems with Excel installed hand .csv files over as
// application/vnd.ms-excel — the same type real legacy .xls binaries carry
// (and occasionally a mislabeled .xlsx). The first bytes disambiguate: OLE
// compound files (.xls) start D0 CF 11 E0…, zip containers (.xlsx) start
// "PK", and anything else under that type is treated as CSV text.
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const sheetKind = (artifact: IDBEvidenceV2): "csv" | "xlsx" | null => {
    if (isCSV(artifact.type)) {
        return "csv";
    }
    if (isExcel(artifact.type)) {
        return "xlsx";
    }
    if (artifact.type !== "application/vnd.ms-excel") {
        return null;
    }
    const head = new Uint8Array(artifact.data.slice(0, 8));
    if (OLE_MAGIC.every((byte, i) => head[i] === byte)) {
        return null; // Real legacy .xls: exceljs cannot read it.
    }
    if (head[0] === 0x50 && head[1] === 0x4b) {
        return "xlsx";
    }
    return "csv";
};

// CSV parses locally; .xlsx goes through exceljs, loaded on demand the first
// time a spreadsheet preview renders (same pattern as pdf.js — never a CDN).
const loadSheets = async (artifact: IDBEvidenceV2): Promise<Sheet[]> => {
    if (sheetKind(artifact) === "csv") {
        return [{ rows: parseCSV(new TextDecoder().decode(artifact.data)) }];
    }
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(artifact.data.slice(0));
    return workbook.worksheets.map((worksheet) => {
        const rows: string[][] = [];
        worksheet.eachRow((row) => {
            // row.values is 1-based and sparse; Array.from turns the holes
            // (skipped empty cells) into empty strings so columns stay
            // aligned.
            rows.push(
                Array.from(row.values as unknown[])
                    .slice(1)
                    .map(cellText),
            );
        });
        return { name: worksheet.name, rows };
    });
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

// Artifacts the previews can actually render (URL evidence and types like
// zip/docx are excluded).
const isPreviewable = (artifact: IDBEvidenceV2) =>
    embeddable(artifact) ||
    snippetable(artifact) ||
    isPDF(artifact.type) ||
    sheetKind(artifact) !== null;

const IconChevronLeft = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        aria-hidden="true"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="m15 19-7-7 7-7"
        />
    </svg>
);

const IconChevronRight = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        aria-hidden="true"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="m9 5 7 7-7 7"
        />
    </svg>
);

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
        isImg || isPdf || isSheet
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
                            ) : (
                                <pre className="w-full whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                                    {text}
                                </pre>
                            )}
                        </div>
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
