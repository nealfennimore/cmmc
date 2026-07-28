"use client";
import { parseCSV } from "@/app/utils/csv";
import { isCSV, isExcel } from "@/app/utils/file";

/** The slice of an artifact the sheet loaders need; `data` is optional for
 *  kind checks made before the payload has been fetched. */
interface SheetSource {
    type: string;
    data?: ArrayBuffer;
}

/** A source whose payload has been fetched. */
interface SheetSourceWithData extends SheetSource {
    data: ArrayBuffer;
}

export interface Sheet {
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
export const sheetKind = (artifact: SheetSource): "csv" | "xlsx" | null => {
    if (isCSV(artifact.type)) {
        return "csv";
    }
    if (isExcel(artifact.type)) {
        return "xlsx";
    }
    if (artifact.type !== "application/vnd.ms-excel") {
        return null;
    }
    // Without the payload (metadata-only kind checks, e.g. preview gating),
    // assume CSV — the common case for this type. Real legacy .xls binaries
    // are caught once the bytes arrive and fall to "preview unavailable".
    if (!artifact.data) {
        return "csv";
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
export const loadSheets = async (
    artifact: SheetSourceWithData,
): Promise<Sheet[]> => {
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
