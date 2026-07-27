"use client";
import { IDBEvidenceText, IDBEvidenceV2 } from "@/app/db";
import { isPDF, snippetable } from "@/app/utils/file";
import { loadPdfjs } from "@/app/utils/pdf";
import { loadSheets, sheetKind } from "@/app/utils/sheets";

/** Bump when extraction improves; the reconciler re-extracts stale rows. */
export const EXTRACTOR_VERSION = 1;

// Extraction is for search, not archival: whole files above the source cap
// are skipped unread, and extracted text is truncated. A 500KB text ceiling
// comfortably covers hundreds of pages of prose while bounding IndexedDB
// growth and index build time.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 500 * 1024;
const MAX_PDF_PAGES = 200;

const extractPdf = async (artifact: IDBEvidenceV2): Promise<string> => {
    const pdfjs = await loadPdfjs();
    // pdf.js transfers the buffer to its worker, which would detach the
    // artifact's in-memory bytes — hand it a copy.
    const task = pdfjs.getDocument({ data: artifact.data.slice(0) });
    try {
        const doc = await task.promise;
        const pages: string[] = [];
        const total = Math.min(doc.numPages, MAX_PDF_PAGES);
        let length = 0;
        for (let i = 1; i <= total && length < MAX_TEXT_CHARS; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const text = content.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(" ");
            pages.push(text);
            length += text.length + 1;
        }
        return pages.join("\n");
    } finally {
        task.destroy();
    }
};

const extractSheet = async (artifact: IDBEvidenceV2): Promise<string> =>
    (await loadSheets(artifact))
        .map((sheet) =>
            [sheet.name ?? "", ...sheet.rows.map((row) => row.join(" "))].join(
                "\n",
            ),
        )
        .join("\n");

/**
 * Extract searchable text from an evidence artifact. Never throws — failures
 * come back as a row with a non-"ok" status so they are persisted and not
 * retried on every load.
 */
export const extractEvidenceText = async (
    artifact: IDBEvidenceV2,
): Promise<IDBEvidenceText> => {
    const base = {
        id: artifact.id,
        extractor: EXTRACTOR_VERSION,
        bytes: artifact.data.byteLength,
    };

    if (artifact.data.byteLength > MAX_SOURCE_BYTES) {
        return { ...base, text: "", status: "skipped" };
    }

    try {
        let text: string | null = null;
        if (artifact.type === "url" || snippetable(artifact)) {
            text = new TextDecoder().decode(artifact.data);
        } else if (isPDF(artifact.type)) {
            text = await extractPdf(artifact);
        } else if (sheetKind(artifact) !== null) {
            text = await extractSheet(artifact);
        }

        if (text === null) {
            return { ...base, text: "", status: "unsupported" };
        }
        return { ...base, text: text.slice(0, MAX_TEXT_CHARS), status: "ok" };
    } catch {
        return { ...base, text: "", status: "error" };
    }
};
