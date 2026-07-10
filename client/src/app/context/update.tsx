"use client";
// App-update state (Keygen Tauri engine). Sits inside LicenseProvider: a
// single silent check runs shortly after launch once the app is licensed, and
// the License modal offers a manual check. In the browser build every wrapper
// no-ops, so this renders inert there.

import { useLicense } from "@/app/context/license";
import {
    updateCheck,
    updateInstall,
    updateRestart,
    type LicenseError,
    type UpdateInfo,
} from "@/app/utils/tauri";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

/** Delay before the launch check, so startup work settles first. */
const LAUNCH_CHECK_DELAY_MS = 8_000;

type UpdatePhase = "idle" | "checking" | "downloading" | "installed";

interface UpdateContextValue {
    /** Result of the most recent check; `null` before any check completes. */
    result: UpdateInfo | null;
    phase: UpdatePhase;
    error: string | null;
    /** Banner dismissal (per session). */
    dismissed: boolean;
    check: () => Promise<void>;
    install: () => Promise<void>;
    restart: () => void;
    dismiss: () => void;
}

const UpdateContext = createContext<UpdateContextValue>({
    result: null,
    phase: "idle",
    error: null,
    dismissed: false,
    check: async () => {},
    install: async () => {},
    restart: () => {},
    dismiss: () => {},
});

export function useUpdate() {
    return useContext(UpdateContext);
}

const errorMessage = (error: unknown): string => {
    const { code, message } = (error ?? {}) as Partial<LicenseError>;
    if (code === "NOT_LICENSED") {
        return "Updates require an active license.";
    }
    return message || "Update check failed. Please try again.";
};

export function UpdateProvider({ children }: { children: React.ReactNode }) {
    const { info } = useLicense();
    const [result, setResult] = useState<UpdateInfo | null>(null);
    const [phase, setPhase] = useState<UpdatePhase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const launchChecked = useRef(false);

    const check = useCallback(async () => {
        setPhase("checking");
        setError(null);
        try {
            const next = await updateCheck();
            if (next) {
                setResult(next);
            }
        } catch (checkError) {
            setError(errorMessage(checkError));
        } finally {
            setPhase("idle");
        }
    }, []);

    // One silent check per session, shortly after the app is licensed.
    useEffect(() => {
        if (launchChecked.current || info?.state !== "licensed") {
            return;
        }
        launchChecked.current = true;
        const timer = window.setTimeout(() => {
            updateCheck()
                .then((next) => next && setResult(next))
                .catch(() => {
                    // Offline or unreachable — updates are best-effort.
                });
        }, LAUNCH_CHECK_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [info?.state]);

    const install = useCallback(async () => {
        setPhase("downloading");
        setError(null);
        try {
            await updateInstall();
            setPhase("installed");
        } catch (installError) {
            setError(errorMessage(installError));
            setPhase("idle");
        }
    }, []);

    const restart = useCallback(() => {
        void updateRestart();
    }, []);

    const dismiss = useCallback(() => setDismissed(true), []);

    return (
        <UpdateContext.Provider
            value={{
                result,
                phase,
                error,
                dismissed,
                check,
                install,
                restart,
                dismiss,
            }}
        >
            {children}
        </UpdateContext.Provider>
    );
}
