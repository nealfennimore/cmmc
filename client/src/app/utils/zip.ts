"use client";

// Minimal zip-entry reader for office documents (docx/pptx/odt are zips of
// XML). Hand-rolled instead of a zip dependency: the only need is "find one
// XML entry and inflate it", the browser ships the inflater
// (DecompressionStream), and evidence bytes must never leave the machine.
// No zip64 — sources are capped at 20MB long before zip64 territory.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

// Zip-bomb hygiene: office documents have dozens of entries, not thousands,
// and no single XML part should inflate anywhere near this.
const MAX_ENTRIES = 4096;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

/** Thrown when the runtime lacks DecompressionStream (very old WebKit);
 *  callers map it to "unsupported" rather than "error". */
export class InflateUnavailableError extends Error {
    constructor() {
        super("DecompressionStream is not available");
    }
}

export interface ZipEntry {
    name: string;
    bytes: Uint8Array;
}

const inflateRaw = async (compressed: Uint8Array): Promise<Uint8Array> => {
    if (typeof DecompressionStream === "undefined") {
        throw new InflateUnavailableError();
    }
    const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Decompress every entry whose name matches. Entries are read via the
 *  central directory, whose sizes are authoritative even for entries written
 *  with data descriptors. */
export const unzipEntries = async (
    data: ArrayBuffer,
    match: (name: string) => boolean,
): Promise<ZipEntry[]> => {
    const view = new DataView(data);
    const bytes = new Uint8Array(data);

    // The end-of-central-directory record sits before a variable-length
    // comment (≤64KB); scan backward for its signature.
    let eocd = -1;
    const scanEnd = Math.max(0, data.byteLength - 22 - 0xffff);
    for (let i = data.byteLength - 22; i >= scanEnd; i--) {
        if (view.getUint32(i, true) === EOCD_SIG) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("Not a zip file");
    }

    const count = Math.min(view.getUint16(eocd + 10, true), MAX_ENTRIES);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const entries: ZipEntry[] = [];

    for (let i = 0; i < count; i++) {
        if (view.getUint32(offset, true) !== CENTRAL_SIG) {
            break;
        }
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(
            bytes.subarray(offset + 46, offset + 46 + nameLength),
        );
        offset += 46 + nameLength + extraLength + commentLength;

        if (!match(name) || uncompressedSize > MAX_ENTRY_BYTES) {
            continue;
        }

        // The local header repeats name/extra with possibly different extra
        // length, so the data offset comes from its own fields.
        if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
            throw new Error("Corrupt zip entry");
        }
        const localName = view.getUint16(localOffset + 26, true);
        const localExtra = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localName + localExtra;
        const compressed = bytes.subarray(start, start + compressedSize);

        if (method === 0) {
            entries.push({ name, bytes: compressed });
        } else if (method === 8) {
            entries.push({ name, bytes: await inflateRaw(compressed) });
        } else {
            throw new Error(`Unsupported zip compression method ${method}`);
        }
    }
    return entries;
};

/** Decompress a single entry by exact name, or null when absent. */
export const unzipEntry = async (
    data: ArrayBuffer,
    name: string,
): Promise<Uint8Array | null> => {
    const [entry] = await unzipEntries(data, (entryName) => entryName === name);
    return entry?.bytes ?? null;
};
