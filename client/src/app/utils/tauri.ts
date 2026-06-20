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
