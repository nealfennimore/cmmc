"use client";
// "License" entry in the navigation menu — desktop builds only (it renders
// nothing while licensing is disabled, i.e. always in the browser build).
// The menu item only *opens* the modal; the modal itself is rendered by the
// app-level LicenseGate, because the nav dropdown unmounts its children on
// any outside click or keypress, which would tear the modal down mid-use.

import { useLicense } from "@/app/context/license";
import { useUpdate } from "@/app/context/update";
import { openExternal } from "@/app/utils/tauri";
import { useState } from "react";
import {
    ActivationForm,
    deactivationErrorMessage,
} from "./license_activation";
import { InfoModal } from "./modal";
import { Badge, Button, menuItemClasses } from "./ui";
import type { BadgeVariant } from "./ui";

const STATE_LABELS: Record<string, { label: string; tone: BadgeVariant }> = {
    unlicensed: { label: "Unlicensed", tone: "danger" },
    licensed: { label: "Licensed", tone: "success" },
    stale: { label: "Needs reconnect", tone: "warning" },
    licenseExpired: { label: "Expired", tone: "danger" },
    invalid: { label: "Invalid", tone: "danger" },
};

const formatDate = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleDateString() : "—";

// Whichever gates first wins: the signed machine file's TTL or the license's
// own expiry. New certificates are TTL-capped at the license expiry, but older
// ones (and clock skew) can still disagree — always show the earlier date.
const earlierDate = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    return new Date(a) <= new Date(b) ? a : b;
};

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
        </div>
    );
}

// "Updates" block inside the License modal: current version, manual check,
// and install/download actions mirroring the update banner.
function UpdatesSection() {
    const { result, phase, error, check, install, restart } = useUpdate();
    const currentVersion =
        result?.currentVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "—";

    return (
        <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <DetailRow label="App version" value={currentVersion} />

            {result?.available && (
                <p>
                    Version {result.version} is available.
                    {result.notes ? ` ${result.notes}` : ""}
                </p>
            )}
            {result && !result.available && <p>You&apos;re up to date.</p>}
            {error && (
                <p role="alert" className="text-red-600">
                    {error}
                </p>
            )}

            <div className="flex gap-2">
                {result?.available &&
                    (phase === "installed" ? (
                        <Button size="sm" onClick={restart}>
                            Restart now
                        </Button>
                    ) : result.platformSupportsInstall ? (
                        <Button
                            size="sm"
                            onClick={install}
                            disabled={phase === "downloading"}
                        >
                            {phase === "downloading"
                                ? "Downloading…"
                                : "Install and restart"}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={() =>
                                result.downloadUrl &&
                                openExternal(result.downloadUrl)
                            }
                        >
                            Download
                        </Button>
                    ))}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={check}
                    disabled={phase !== "idle"}
                >
                    {phase === "checking"
                        ? "Checking…"
                        : "Check for updates"}
                </Button>
            </div>
        </div>
    );
}

export const LicenseMenuItem = () => {
    const { info, openSettings } = useLicense();

    // Browser build (or licensing not configured): no menu entry at all.
    if (!info || info.state === "disabled") {
        return null;
    }

    return (
        <button
            type="button"
            className={menuItemClasses()}
            onClick={openSettings}
            tabIndex={-1}
        >
            <span>License</span>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="h-4"
            >
                <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15 7.5a4.5 4.5 0 1 1-4.86 4.485L4.5 17.62V19.5h3v-2h2v-2h2l1.106-1.106A4.5 4.5 0 0 1 15 7.5Zm1.5 2.25h.008v.008H16.5V9.75Z"
                />
            </svg>
        </button>
    );
};

/** Rendered once at the app level (by LicenseGate), opened via context. */
export const LicenseSettingsModal = () => {
    const { info, deactivate, refresh, settingsOpen, closeSettings } =
        useLicense();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

    if (!info || info.state === "disabled" || !settingsOpen) {
        return null;
    }

    const licensed = ["licensed", "stale", "licenseExpired"].includes(
        info.state,
    );
    const badge =
        info.state === "licensed" && info.licenseIsTrial
            ? { label: "Trial license", tone: "warning" as BadgeVariant }
            : STATE_LABELS[info.state];

    const onRefresh = async () => {
        setBusy(true);
        setError(null);
        try {
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const onDeactivate = async () => {
        setBusy(true);
        setError(null);
        try {
            await deactivate();
            setConfirmingDeactivate(false);
        } catch (deactivationError) {
            setError(deactivationErrorMessage(deactivationError));
        } finally {
            setBusy(false);
        }
    };

    return (
        <InfoModal open title="License" onClose={closeSettings}>
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {badge && <Badge variant={badge.tone}>{badge.label}</Badge>}
                </div>

                {licensed ? (
                    <div className="flex flex-col gap-2 text-sm">
                        <DetailRow
                            label="License key"
                            value={info.keyMasked ?? "—"}
                        />
                        <DetailRow
                            label="Activated"
                            value={formatDate(info.activatedAt)}
                        />
                        <DetailRow
                            label={
                                info.licenseIsTrial
                                    ? "Trial ends"
                                    : "License expires"
                            }
                            value={
                                info.licenseExpiry
                                    ? formatDate(info.licenseExpiry)
                                    : "Never"
                            }
                        />
                        <DetailRow
                            label="Works offline until"
                            value={formatDate(
                                earlierDate(
                                    info.machineFileExpiry,
                                    info.licenseExpiry,
                                ),
                            )}
                        />

                        {info.licenseIsTrial && info.state === "licensed" && (
                            <p>
                                This is a trial license. Enter a purchased key
                                below at any time to upgrade — your data is
                                unaffected.
                            </p>
                        )}

                        {error && (
                            <p role="alert" className="text-red-600">
                                {error}
                            </p>
                        )}

                        {confirmingDeactivate ? (
                            <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-secondary p-3">
                                <p>
                                    Deactivating frees up a seat on your
                                    license and returns this app to the
                                    unlicensed state. Your compliance data is
                                    not affected.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setConfirmingDeactivate(false)
                                        }
                                        disabled={busy}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={onDeactivate}
                                        disabled={busy}
                                    >
                                        {busy
                                            ? "Deactivating…"
                                            : "Yes, deactivate"}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-2 flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={onRefresh}
                                    disabled={busy}
                                >
                                    Refresh
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() =>
                                        setConfirmingDeactivate(true)
                                    }
                                    disabled={busy}
                                >
                                    Deactivate this device
                                </Button>
                            </div>
                        )}

                        {info.licenseIsTrial && info.state === "licensed" && (
                            <div className="mt-2 border-t border-border pt-3">
                                <ActivationForm />
                            </div>
                        )}
                    </div>
                ) : (
                    <ActivationForm />
                )}

                {["licensed", "stale"].includes(info.state) && (
                    <UpdatesSection />
                )}
            </div>
        </InfoModal>
    );
};
