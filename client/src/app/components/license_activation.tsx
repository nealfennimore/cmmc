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
    SIGNATURE:
        "The licensing server's response couldn't be verified. Check that your system clock is correct and that nothing on the network is intercepting HTTPS traffic, then try again.",
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
        return "Deactivation needs an internet connection so the seat can be freed on the license. Check your connection and try again. For a permanently offline device, remove this machine from your licensing dashboard instead.";
    }
    return message || "Deactivation failed unexpectedly. Please try again.";
};

const IMPORT_ERROR_COPY: Record<string, string> = {
    WRONG_MACHINE:
        "That license file was issued for a different device. Check out a file for this device's fingerprint (shown above) and try again.",
    FILE_STALE:
        "That license file has lapsed — or this device's clock is far off. Check the clock, or check out a fresh file and try again.",
    EXPIRED:
        "The license inside that file has expired. Renew the license, check out a fresh file, and try again.",
    MALFORMED:
        "That doesn't look like a license file for this app. Re-run the checkout following the air-gapped steps in the documentation.",
};

export const importErrorMessage = (error: unknown): string => {
    const { code, message } = (error ?? {}) as Partial<LicenseError>;
    return (
        (code && IMPORT_ERROR_COPY[code]) ||
        message ||
        "The license file could not be imported. Please try again."
    );
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

/**
 * Air-gapped activation/renewal, shared by the blocking gate and the license
 * settings modal: shows this device's fingerprint (needed to check out a
 * license file on a connected machine) and imports the resulting file. See
 * docs/licensing.md § Air-gapped devices for the checkout steps.
 */
export function AirGappedImport({ onImported }: { onImported?: () => void }) {
    const { info, importFile } = useLicense();
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [copied, setCopied] = useState(false);

    const copyFingerprint = async () => {
        if (!info?.fingerprint) return;
        try {
            await navigator.clipboard.writeText(info.fingerprint);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard unavailable — the fingerprint is still selectable.
        }
    };

    const onImport = async () => {
        setPending(true);
        setError(null);
        try {
            await importFile();
            onImported?.();
        } catch (importError) {
            setError(importErrorMessage(importError));
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
                A device that can never go online is licensed with a license
                file instead: copy this device&apos;s fingerprint, check out a
                file for it on a connected machine (see the air-gapped section
                of the licensing docs), bring the file over, and import it
                here. Renew the same way before the file lapses.
            </p>
            <div className="flex items-center gap-2">
                <code
                    className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 font-mono text-xs"
                    title={info?.fingerprint ?? undefined}
                >
                    {info?.fingerprint ?? "—"}
                </code>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyFingerprint}
                    disabled={!info?.fingerprint}
                >
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            {error && (
                <p role="alert" className="text-red-600">
                    {error}
                </p>
            )}
            <Button
                type="button"
                variant="outline"
                onClick={onImport}
                disabled={pending}
            >
                {pending ? "Importing…" : "Import license file…"}
            </Button>
        </div>
    );
}
