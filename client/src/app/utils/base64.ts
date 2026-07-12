// Native base64 helpers. FileReader/data-URL round-trips run in the engine's
// native code, so they stay fast for multi-megabyte payloads — unlike
// per-byte JS conversions (spread / Array.from over a Uint8Array), which
// stall the UI for large evidence sets.

export const toBase64 = (data: Blob | ArrayBuffer): Promise<string> =>
    new Promise((resolve, reject) => {
        const blob = data instanceof Blob ? data : new Blob([data]);
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

export const fromBase64 = async (base64: string): Promise<ArrayBuffer> => {
    const response = await fetch(
        `data:application/octet-stream;base64,${base64}`,
    );
    return response.arrayBuffer();
};
