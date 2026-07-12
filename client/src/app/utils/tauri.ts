// Helpers for the optional Tauri desktop shell. These are no-ops in the browser
// build, so nothing here pulls in a Tauri dependency — we talk to the plugin
// through the IPC bridge Tauri injects at runtime.

import { toBase64 } from "./base64";

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

export type LicenseState =
    | "disabled"
    | "unlicensed"
    | "licensed"
    | "stale"
    | "licenseExpired"
    | "invalid";

/** Summary of the desktop license, as computed by the Rust side. */
export interface LicenseInfo {
    state: LicenseState;
    /** For an activated trial license, days until it expires. */
    trialDaysRemaining: number | null;
    /** True when the activated key is a Keygen trial license. */
    licenseIsTrial: boolean;
    keyMasked: string | null;
    machineFileExpiry: string | null;
    licenseExpiry: string | null;
    activatedAt: string | null;
    /** This device's fingerprint (a salted hash) — shown for air-gapped registration. */
    fingerprint: string | null;
}

export interface LicenseError {
    code: string;
    message: string;
}

// Tauri command failures reject with the serialized Rust LicenseError; anything
// else (bridge failures, panics) is folded into a generic error shape.
const toLicenseError = (error: unknown): LicenseError => {
    if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "message" in error
    ) {
        return error as LicenseError;
    }
    return { code: "API_ERROR", message: String(error) };
};

/** Current license state, or `null` in the browser build. Offline and fast. */
export const licenseStatus = async (): Promise<LicenseInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<LicenseInfo>("license_status");
    } catch (error) {
        console.error("Failed to read license status", error);
        return null;
    }
};

/**
 * Activate a license key (one-time, needs network). Resolves the new license
 * state or throws a {@link LicenseError}. No-ops (`null`) in the browser.
 */
export const licenseActivate = async (
    key: string,
): Promise<LicenseInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<LicenseInfo>("license_activate", { key });
    } catch (error) {
        throw toLicenseError(error);
    }
};

/**
 * Air-gapped activation: pick and import a machine file checked out on a
 * connected machine (fully offline; Rust opens the file dialog and verifies
 * the file). Resolves the new license state — unchanged if the picker was
 * cancelled — or throws a {@link LicenseError}. No-ops (`null`) in the browser.
 */
export const licenseImport = async (): Promise<LicenseInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<LicenseInfo>("license_import");
    } catch (error) {
        throw toLicenseError(error);
    }
};

/**
 * Best-effort machine-file refresh; silently keeps the current state when
 * offline. Returns `null` in the browser build.
 */
export const licenseRefresh = async (): Promise<LicenseInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<LicenseInfo>("license_refresh");
    } catch (error) {
        console.error("Failed to refresh license", error);
        return null;
    }
};

/**
 * Release this device's seat on the license (needs network). Resolves the new
 * state or throws a {@link LicenseError}. No-ops (`null`) in the browser.
 */
export const licenseDeactivate = async (): Promise<LicenseInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<LicenseInfo>("license_deactivate");
    } catch (error) {
        throw toLicenseError(error);
    }
};

/** Result of an update check against the Keygen distribution engine. */
export interface UpdateInfo {
    available: boolean;
    currentVersion: string;
    version: string | null;
    notes: string | null;
    /** False on Linux — offer the download page instead of installing. */
    platformSupportsInstall: boolean;
    downloadUrl: string | null;
}

/**
 * Check for an app update (requires an active license). Resolves the result
 * or throws a {@link LicenseError}; `null` in the browser build.
 */
export const updateCheck = async (): Promise<UpdateInfo | null> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return null;
    }
    try {
        return await internals.invoke<UpdateInfo>("update_check");
    } catch (error) {
        throw toLicenseError(error);
    }
};

/**
 * Download and apply the update found by the last check. Throws a
 * {@link LicenseError} on failure. On Windows the installer may exit and
 * relaunch the app before this resolves. No-op in the browser build.
 */
export const updateInstall = async (): Promise<void> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return;
    }
    try {
        await internals.invoke("update_install");
    } catch (error) {
        throw toLicenseError(error);
    }
};

/** Relaunch the app to finish applying an update. No-op in the browser. */
export const updateRestart = async (): Promise<void> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return;
    }
    try {
        await internals.invoke("update_restart");
    } catch (error) {
        console.error("Failed to restart for update", error);
    }
};

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
 * Pick a JSON file via a native open dialog and return its text. Returns
 * `false` in the browser build (fall back to an <input type=file>), `null`
 * when the user cancels, and the file contents otherwise.
 */
export const openJsonFile = async (): Promise<string | null | false> => {
    const internals =
        typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
    if (!internals?.invoke) {
        return false;
    }
    try {
        return await internals.invoke<string | null>("open_json_file");
    } catch (error) {
        console.error("Failed to open file via Tauri", error);
        return null;
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
        // Bytes cross the IPC bridge as one base64 string: a JSON number
        // array costs serde a parse per byte and stalls on 100MB+ exports.
        const dataB64 = await toBase64(blob);
        await internals.invoke("save_file", { filename, dataB64 });
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
                dataB64: await toBase64(blob),
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
            dataB64: await toBase64(data),
        });
        return true;
    } catch (error) {
        console.error("Failed to open evidence file via Tauri", error);
        return false;
    }
};
