// Helpers for the optional Tauri desktop shell. These are no-ops in the browser
// build, so nothing here pulls in a Tauri dependency — we talk to the plugin
// through the IPC bridge Tauri injects at runtime.

interface TauriInternals {
    invoke<T = unknown>(
        cmd: string,
        args?: Record<string, unknown>,
    ): Promise<T>;
}

declare global {
    interface Window {
        __TAURI_INTERNALS__?: TauriInternals;
    }
}

/** True when running inside the Tauri desktop shell. */
export const isTauri = (): boolean =>
    typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/**
 * Open a URL in the user's default browser via tauri-plugin-opener. Returns
 * `true` if Tauri handled it, `false` otherwise (e.g. in the browser build) so
 * callers can fall back to normal web behavior.
 */
export const openExternal = async (url: string): Promise<boolean> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return false;
    }
    try {
        await internals.invoke("open_external", { url });
        return true;
    } catch (error) {
        console.error("Failed to open external URL via Tauri", error);
        return false;
    }
};

/**
 * Save a single file via a native save dialog. Returns `true` when running in
 * Tauri (so callers skip the browser download), `false` in the browser build.
 */
export const saveFile = async (
    filename: string,
    blob: Blob,
): Promise<boolean> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return false;
    }
    try {
        const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await internals.invoke("save_file", { filename, data });
    } catch (error) {
        console.error("Failed to save file via Tauri", error);
    }
    return true;
};

/**
 * Save several files into a user-chosen folder (one picker for the whole set).
 * Returns `true` when running in Tauri, `false` in the browser build.
 */
export const saveFilesToDirectory = async (
    files: { filename: string; blob: Blob }[],
): Promise<boolean> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return false;
    }
    try {
        const payload = await Promise.all(
            files.map(async ({ filename, blob }) => ({
                filename,
                data: Array.from(new Uint8Array(await blob.arrayBuffer())),
            })),
        );
        await internals.invoke("save_files", { files: payload });
    } catch (error) {
        console.error("Failed to save files via Tauri", error);
    }
    return true;
};

/**
 * Open an evidence file in the OS default application. The desktop webview
 * can't open the blob URLs the web build uses, so we hand the bytes to Rust,
 * which writes a temp file and opens it. Returns `false` outside Tauri.
 */
export const openFileInSystemViewer = async (
    filename: string,
    data: ArrayBuffer,
): Promise<boolean> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return false;
    }
    try {
        await internals.invoke("open_evidence", {
            filename,
            data: Array.from(new Uint8Array(data)),
        });
        return true;
    } catch (error) {
        console.error("Failed to open evidence file via Tauri", error);
        return false;
    }
};
