"use client";
// Desktop licensing state. All enforcement lives on the Rust side; this
// context just mirrors the LicenseInfo summary so the UI can gate and render.
// In the browser build every command no-ops and the state pins to "disabled".

import {
    isTauri,
    licenseActivate,
    licenseDeactivate,
    licenseImport,
    licenseRefresh,
    licenseStatus,
    type LicenseInfo,
} from "@/app/utils/tauri";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

const DISABLED: LicenseInfo = {
    state: "disabled",
    trialDaysRemaining: null,
    licenseIsTrial: false,
    keyMasked: null,
    machineFileExpiry: null,
    licenseExpiry: null,
    activatedAt: null,
    activationMethod: null,
    fingerprint: null,
};

interface LicenseContextValue {
    /** `null` until the first status read resolves (and during SSR). */
    info: LicenseInfo | null;
    /** Throws a `LicenseError` on failure. */
    activate: (key: string) => Promise<void>;
    /**
     * Air-gapped activation/renewal via a machine-file import (Rust opens
     * the picker). Throws a `LicenseError` on failure.
     */
    importFile: () => Promise<void>;
    /** Throws a `LicenseError` on failure (e.g. offline). */
    deactivate: () => Promise<void>;
    refresh: () => Promise<void>;
    /**
     * The license settings modal is rendered by the app-level LicenseGate,
     * not by the navigation menu item that opens it — the nav dropdown
     * unmounts its children whenever it closes (any outside click/keypress),
     * which would tear the modal down mid-use.
     */
    settingsOpen: boolean;
    openSettings: () => void;
    closeSettings: () => void;
}

const LicenseContext = createContext<LicenseContextValue>({
    info: DISABLED,
    activate: async () => {},
    importFile: async () => {},
    deactivate: async () => {},
    refresh: async () => {},
    settingsOpen: false,
    openSettings: () => {},
    closeSettings: () => {},
});

export function useLicense() {
    return useContext(LicenseContext);
}

export function LicenseProvider({ children }: { children: React.ReactNode }) {
    const [info, setInfo] = useState<LicenseInfo | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!isTauri()) {
                setInfo(DISABLED);
                return;
            }
            const status = await licenseStatus();
            if (cancelled) return;
            // Fail closed: there is no local trial, so a status-command error
            // (e.g. an unreadable app-data dir) must not unlock the app —
            // otherwise breaking the license dir would be a full bypass. The
            // "invalid" gate tells legitimate users to re-activate.
            setInfo(status ?? { ...DISABLED, state: "invalid" });

            // Opportunistically refresh the machine file in the background;
            // silently keeps the current state when offline.
            const refreshed = await licenseRefresh();
            if (!cancelled && refreshed) {
                setInfo(refreshed);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const activate = useCallback(async (key: string) => {
        const next = await licenseActivate(key);
        if (next) {
            setInfo(next);
        }
    }, []);

    const importFile = useCallback(async () => {
        const next = await licenseImport();
        if (next) {
            setInfo(next);
        }
    }, []);

    const deactivate = useCallback(async () => {
        const next = await licenseDeactivate();
        if (next) {
            setInfo(next);
        }
    }, []);

    const refresh = useCallback(async () => {
        const next = await licenseRefresh();
        if (next) {
            setInfo(next);
        }
    }, []);

    const openSettings = useCallback(() => setSettingsOpen(true), []);
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    return (
        <LicenseContext.Provider
            value={{
                info,
                activate,
                importFile,
                deactivate,
                refresh,
                settingsOpen,
                openSettings,
                closeSettings,
            }}
        >
            {children}
        </LicenseContext.Provider>
    );
}
