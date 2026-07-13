"use client";
import { IDBEvidenceV2 } from "@/app/db";
import { saveFile } from "./tauri";

export const toFSName = (artifact: IDBEvidenceV2) =>
    `${artifact.id}-${artifact.filename}`;

/**
 * Save a blob to disk. In the desktop shell this opens a native save dialog;
 * in the browser it falls back to the standard anchor download.
 */
export const saveBlob = async (filename: string, blob: Blob): Promise<void> => {
    if (await saveFile(filename, blob)) {
        return;
    }

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
};

export enum HashType {
    SHA256 = "sha256",
    SHA1 = "sha1",
    UUID = "uuid",
}

export const hashType = (hash: string) => {
    if (hash.includes("-")) {
        return HashType.UUID; // Legacy
    }

    if (hash.length === 40) {
        return HashType.SHA1; // Legacy
    }

    return HashType.SHA256;
};

// Human-readable label for an artifact's MIME type — the Word docx type
// alone is 72 characters. Falls back to the raw type for anything unmapped.
const MIME_LABELS: Record<string, string> = {
    url: "URL",
    "application/pdf": "PDF",
    "application/msword": "Word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        "Word",
    "application/vnd.ms-excel": "Spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        "Spreadsheet",
    "application/vnd.ms-powerpoint": "PowerPoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        "PowerPoint",
    "application/vnd.oasis.opendocument.presentation":
        "OpenDocument presentation",
    "application/vnd.oasis.opendocument.spreadsheet":
        "OpenDocument spreadsheet",
    "application/vnd.oasis.opendocument.text": "OpenDocument document",
    "application/zip": "ZIP",
    "application/x-zip-compressed": "ZIP",
    "application/gzip": "Gzip",
    "application/json": "JSON",
    "application/xml": "XML",
    "application/octet-stream": "Binary file",
    "text/plain": "Text",
    "text/csv": "CSV",
    "text/html": "HTML",
    "text/css": "CSS",
    "text/md": "Markdown",
    "text/javascript": "JavaScript",
    "text/xml": "XML",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/gif": "GIF",
    "image/webp": "WebP",
    "image/svg+xml": "SVG",
};

export const mimeLabel = (type: string): string =>
    MIME_LABELS[type] ?? (type || "Unknown");

export const isImage = (type: string) => {
    switch (type) {
        case "image/png":
        case "image/gif":
        case "image/svg+xml":
        case "image/jpeg":
        case "image/webp":
            return true;
        default:
            return false;
    }
};

export const isPDF = (type: string) => {
    switch (type) {
        case "application/pdf":
            return true;
        default:
            return false;
    }
};

export const isCode = (type: string) => {
    switch (type) {
        case "text/javascript":
        case "text/css":
        case "text/html":
        case "text/xml":
        case "application/xml":
        case "application/json":
            return true;
        default:
            return false;
    }
};

// Only modern .xlsx — exceljs cannot read the legacy .xls binary format,
// which keeps its icon + system-viewer fallback.
export const isExcel = (type: string) => {
    switch (type) {
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return true;
        default:
            return false;
    }
};

export const isCSV = (type: string) => {
    switch (type) {
        case "text/csv":
        case "application/csv":
        case "application/vnd.ms-excel":
            return true;
        default:
            return false;
    }
};

export const isSheet = (type: string) => isCSV(type) || isExcel(type);

// Generic documents; Word files have their own check (isWord).
export const isDoc = (type: string) => {
    switch (type) {
        case "application/vnd.oasis.opendocument.text":
        case "application/rtf":
        case "text/plain":
        case "text/md":
            return true;
        default:
            return false;
    }
};

export const isMusic = (type: string) => {
    switch (type) {
        case "audio/mpeg":
        case "audio/mp4":
        case "audio/wav":
        case "audio/x-wav":
        case "audio/ogg":
        case "audio/aac":
        case "audio/flac":
        case "audio/webm":
            return true;
        default:
            return false;
    }
};

// OpenDocument presentations are included: same document class.
export const isPowerpoint = (type: string) => {
    switch (type) {
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        case "application/vnd.oasis.opendocument.presentation":
            return true;
        default:
            return false;
    }
};

export const isWord = (type: string) => {
    switch (type) {
        case "application/msword":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return true;
        default:
            return false;
    }
};

export const isVideo = (type: string) => {
    switch (type) {
        case "video/mp4":
        case "video/webm":
        case "video/ogg":
        case "video/quicktime":
        case "video/x-msvideo":
        case "video/mpeg":
            return true;
        default:
            return false;
    }
};

export const isZip = (type: string) => {
    switch (type) {
        case "application/zip":
        case "application/x-zip-compressed":
        case "application/gzip":
        case "application/x-tar":
        case "application/x-7z-compressed":
        case "application/x-rar-compressed":
            return true;
        default:
            return false;
    }
};

export const embeddable = (artifact: IDBEvidenceV2) => isImage(artifact.type);

const isText = (type: string) => {
    switch (type) {
        case "text/plain":
        case "text/javascript":
        case "application/json":
        case "text/css":
        case "text/html":
        case "text/xml":
        case "text/md":
            return true;
        default:
            return false;
    }
};

export const snippetable = (artifact: IDBEvidenceV2) => isText(artifact.type);
