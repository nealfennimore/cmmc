"use client";
// Desktop license gate. The app content always renders (the static web build
// must stay untouched); blocking license states drop an opaque overlay on top,
// and an activated Keygen trial license shows a slim countdown banner.
// Enforcement itself happens in Rust — this component only reflects the state
// it reports.

import { useLicense } from "@/app/context/license";
import type { LicenseInfo } from "@/app/utils/tauri";
import { ReactNode, useEffect, useRef, useState } from "react";
import { ActivationForm, AirGappedImport } from "./license_activation";
import { LicenseSettingsModal } from "./license_settings";
import { InfoModal } from "./modal";
import { Button } from "./ui";
import { UpdateBanner } from "./update_banner";

const BLOCKING_COPY: Record<
    string,
    { title: (info: LicenseInfo) => string; body: (info: LicenseInfo) => ReactNode }
> = {
    unlicensed: {
        title: () => "Activate your license",
        body: () =>
            "Enter your license key to get started — activation needs an internet connection just this once, then the app works fully offline. Trial keys work here too.",
    },
    stale: {
        title: () => "License needs to reconnect",
        body: () =>
            "This device's offline license file has lapsed. Connect to the internet and retry — the app will fetch a fresh one automatically. You can also re-enter your license key.",
    },
    licenseExpired: {
        title: (info) =>
            info.licenseIsTrial
                ? "Your trial license has ended"
                : "Your license has expired",
        body: (info) =>
            info.licenseIsTrial
                ? "Thanks for trying the app with a trial license. Enter a purchased license key to keep going — all of your data is still here."
                : "Renew your license to keep using the app, then activate with your key. All of your data is still here.",
    },
    invalid: {
        title: () => "License problem",
        body: () =>
            "The license on this device could not be verified. Re-enter your license key to reactivate.",
    },
};

function BlockingOverlay({ info }: { info: LicenseInfo }) {
    const { refresh } = useLicense();
    const [retrying, setRetrying] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);
    const copy = BLOCKING_COPY[info.state];

    // Keep keyboard focus out of the (fully rendered) app behind the overlay.
    // The overlay is a direct child of <body>, so make its siblings inert
    // rather than wrapping the app in a div — globals.css relies on
    // `body > div.main-wrapper`.
    useEffect(() => {
        const overlay = overlayRef.current;
        const siblings = Array.from(document.body.children).filter(
            (element) => element !== overlay && !element.hasAttribute("inert"),
        );
        siblings.forEach((element) => element.setAttribute("inert", ""));
        return () =>
            siblings.forEach((element) => element.removeAttribute("inert"));
    }, []);

    const retry = async () => {
        setRetrying(true);
        try {
            await refresh();
        } finally {
            setRetrying(false);
        }
    };

    return (
        <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label={copy.title(info)}
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-background p-4"
        >
            <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
                <h2 className="text-lg font-semibold tracking-tight">
                    {copy.title(info)}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {copy.body(info)}
                </p>
                <div className="mt-5">
                    <ActivationForm />
                </div>
                {info.state === "stale" && (
                    <Button
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={retry}
                        disabled={retrying}
                    >
                        {retrying ? "Checking…" : "I'm back online — retry"}
                    </Button>
                )}
                {/* Air-gapped path on every blocking state: first activation
                    (unlicensed), offline renewal (stale), and recovery. */}
                <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                        This device can&apos;t go online?
                    </summary>
                    <div className="mt-3">
                        <AirGappedImport />
                    </div>
                </details>
            </div>
        </div>
    );
}

function TrialBanner({ info }: { info: LicenseInfo }) {
    const [dismissed, setDismissed] = useState(false);
    const [activating, setActivating] = useState(false);
    const days = info.trialDaysRemaining ?? 0;

    if (dismissed) {
        return null;
    }

    return (
        <>
            <div className="relative flex w-full items-center justify-center gap-3 border-t border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
                <span>
                    Trial license — {days} {days === 1 ? "day" : "days"}{" "}
                    remaining.
                </span>
                <button
                    type="button"
                    onClick={() => setActivating(true)}
                    className="font-medium text-white underline underline-offset-2 hover:no-underline"
                >
                    Enter license key
                </button>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss trial notice"
                    className="absolute right-3 rounded-md px-2 py-0.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                    ✕
                </button>
            </div>
            <InfoModal
                open={activating}
                title="Activate license"
                onClose={() => setActivating(false)}
            >
                <ActivationForm onActivated={() => setActivating(false)} />
            </InfoModal>
        </>
    );
}

const showsTrialBanner = (info: LicenseInfo): boolean =>
    info.state === "licensed" && info.licenseIsTrial;

export function LicenseGate({ children }: { children: React.ReactNode }) {
    const { info } = useLicense();

    return (
        <>
            {children}
            {info && info.state in BLOCKING_COPY && (
                <BlockingOverlay info={info} />
            )}
            {/* Banner stack: update notice and trial countdown are rows here
                so they never overlap each other at the bottom edge. */}
            <div className="fixed bottom-0 start-0 z-40 flex w-full flex-col">
                <UpdateBanner />
                {info && showsTrialBanner(info) && <TrialBanner info={info} />}
            </div>
            <LicenseSettingsModal />
        </>
    );
}
