"use client";
import { IDBEvidenceText, IDBEvidenceV2 } from "@/app/db";
import {
    isDocx,
    isOpenDocument,
    isPDF,
    isPptx,
    isRTF,
    snippetable,
} from "@/app/utils/file";
import { loadPdfjs } from "@/app/utils/pdf";
import { loadSheets, sheetKind } from "@/app/utils/sheets";
import {
    InflateUnavailableError,
    unzipEntries,
    unzipEntry,
} from "@/app/utils/zip";

/** Bump when extraction improves; the reconciler re-extracts stale rows.
 *  v2: office documents (docx/pptx/odt/odp/ods/rtf). */
export const EXTRACTOR_VERSION = 2;

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

// Decode an XML part and pull its readable text: one line per paragraph
// element, falling back to the document's whole text content when the format
// doesn't use the given paragraph tag (e.g. ods spreadsheets). DOMParser
// handles entity decoding; a parse failure surfaces as a parsererror element
// rather than a throw.
const xmlText = (bytes: Uint8Array, paragraphTag: string): string => {
    const doc = new DOMParser().parseFromString(
        new TextDecoder().decode(bytes),
        "application/xml",
    );
    if (doc.getElementsByTagName("parsererror").length) {
        throw new Error("Malformed XML document part");
    }
    const paragraphs = Array.from(doc.getElementsByTagName(paragraphTag))
        .map((paragraph) => paragraph.textContent?.trim() ?? "")
        .filter(Boolean);
    return paragraphs.length
        ? paragraphs.join("\n")
        : (doc.documentElement?.textContent ?? "");
};

const extractDocx = async (artifact: IDBEvidenceV2): Promise<string> => {
    const xml = await unzipEntry(artifact.data, "word/document.xml");
    if (!xml) {
        throw new Error("docx has no word/document.xml");
    }
    return xmlText(xml, "w:p");
};

const extractPptx = async (artifact: IDBEvidenceV2): Promise<string> => {
    const slides = await unzipEntries(artifact.data, (name) =>
        /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(name),
    );
    // Reading order: slides before notes, then numerically (slide2 before
    // slide10, which a plain name sort would invert).
    const slideIndex = (name: string) =>
        Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
    const group = (name: string) => name.replace(/\d+\.xml$/, "");
    return slides
        .sort(
            (a, b) =>
                group(a.name).localeCompare(group(b.name)) ||
                slideIndex(a.name) - slideIndex(b.name),
        )
        .map((slide) => xmlText(slide.bytes, "a:p"))
        .filter(Boolean)
        .join("\n");
};

const extractOpenDocument = async (
    artifact: IDBEvidenceV2,
): Promise<string> => {
    const xml = await unzipEntry(artifact.data, "content.xml");
    if (!xml) {
        throw new Error("OpenDocument file has no content.xml");
    }
    return xmlText(xml, "text:p");
};

// Best-effort RTF-to-text for search indexing: drop header tables and
// ignorable {\*…} groups (fonts, styles, embedded data), decode \'hh hex
// escapes, then strip the remaining control words and group braces.
const extractRtf = (artifact: IDBEvidenceV2): string =>
    new TextDecoder()
        .decode(artifact.data)
        .replace(
            /\{\\(?:fonttbl|colortbl|stylesheet|info)(?:[^{}]|\{[^{}]*\})*\}/g,
            " ",
        )
        .replace(/\{\\\*[^{}]*\}/g, " ")
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
        )
        .replace(/\\[a-zA-Z]+-?\d*\s?/g, " ")
        .replace(/[{}]|\\[^a-zA-Z]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

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
        } else if (isDocx(artifact.type)) {
            text = await extractDocx(artifact);
        } else if (isPptx(artifact.type)) {
            text = await extractPptx(artifact);
        } else if (isOpenDocument(artifact.type)) {
            text = await extractOpenDocument(artifact);
        } else if (isRTF(artifact.type)) {
            text = extractRtf(artifact);
        }

        if (text === null) {
            return { ...base, text: "", status: "unsupported" };
        }
        return { ...base, text: text.slice(0, MAX_TEXT_CHARS), status: "ok" };
    } catch (error) {
        // A runtime without DecompressionStream can't inflate office zips —
        // an environment limitation, not a broken file.
        if (error instanceof InflateUnavailableError) {
            return { ...base, text: "", status: "unsupported" };
        }
        return { ...base, text: "", status: "error" };
    }
};
