"use client";
// License key entry, shared by the blocking gate, the trial banner and the
// license settings modal. Talks to the Rust side through the license context.

import { useLicense } from "@/app/context/license";
import type { LicenseError } from "@/app/utils/tauri";
import { FormEvent, useState } from "react";
import { Button, Input, Label } from "./ui";

const ACTIVATION_ERROR_COPY: Record<string, string> = {
    INVALID_KEY: "That key wasn't recognized — check it for typos.",
    MACHINE_LIMIT:
        "This license is already active on its maximum number of devices. Deactivate it on another device first, or contact support.",
    NETWORK:
        "Activation needs an internet connection (just this once). Check your connection and try again.",
    EXPIRED: "This license has expired. Renew it to keep using the app.",
    SUSPENDED: "This license has been suspended. Please contact support.",
};

export const activationErrorMessage = (error: unknown): string => {
    const { code, message } = (error ?? {}) as Partial<LicenseError>;
    return (
        (code && ACTIVATION_ERROR_COPY[code]) ||
        message ||
        "Activation failed unexpectedly. Please try again."
    );
};

export const deactivationErrorMessage = (error: unknown): string => {
    const { code, message } = (error ?? {}) as Partial<LicenseError>;
    if (code === "NETWORK") {
        return "Deactivation needs an internet connection so the seat can be freed on the license. Check your connection and try again.";
    }
    return message || "Deactivation failed unexpectedly. Please try again.";
};

/** License key input + activate button. */
export function ActivationForm({ onActivated }: { onActivated?: () => void }) {
    const { activate } = useLicense();
    const [key, setKey] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            await activate(key);
            onActivated?.();
        } catch (activationError) {
            setError(activationErrorMessage(activationError));
        } finally {
            setPending(false);
        }
    };

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="license-key">License key</Label>
                <Input
                    id="license-key"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            <Button type="submit" disabled={pending || !key.trim()}>
                {pending ? "Activating…" : "Activate"}
            </Button>
        </form>
    );
}
