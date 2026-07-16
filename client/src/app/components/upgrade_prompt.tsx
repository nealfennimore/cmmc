"use client";
import { isFreeTier } from "@/app/utils/tier";
import { useEffect, useState } from "react";
import { IconLock, IconX } from "./icons";
import { SEEN_KEY as TOUR_SEEN_KEY } from "./tour";
import { buttonClasses } from "./ui";
import { marketingUrl } from "./upgrade_cta";

const SNOOZE_KEY = "cmmc.upgrade-prompt.snoozed-until";
const SNOOZE_DAYS = 14;
/** Let the page settle before sliding the card in. */
const SHOW_DELAY_MS = 4000;

/**
 * Floating license-purchase prompt for the free web tier. Non-modal so it
 * never blocks the requirement the visitor came for; it waits its turn behind
 * the first-visit tour and snoozes for two weeks when dismissed.
 */
export const UpgradePrompt = () => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isFreeTier()) {
            return;
        }
        try {
            // The intro tour owns the first visit; prompt from the next one.
            if (window.localStorage.getItem(TOUR_SEEN_KEY) !== "1") {
                return;
            }
            const snoozedUntil = Number(
                window.localStorage.getItem(SNOOZE_KEY) ?? 0,
            );
            if (Date.now() < snoozedUntil) {
                return;
            }
        } catch {
            // Storage unavailable (privacy mode): without a way to remember a
            // dismissal, showing the prompt every visit would just nag.
            return;
        }
        const timer = window.setTimeout(
            () => setVisible(true),
            SHOW_DELAY_MS,
        );
        return () => window.clearTimeout(timer);
    }, []);

    const dismiss = () => {
        setVisible(false);
        try {
            window.localStorage.setItem(
                SNOOZE_KEY,
                String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
            );
        } catch {}
    };

    if (!visible) {
        return null;
    }

    return (
        <aside
            role="dialog"
            aria-label="Get the full app"
            className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
        >
            <div className="flex items-start justify-between gap-2">
                <h4 className="flex items-center gap-2 font-semibold tracking-tight">
                    <IconLock className="h-4 w-4 shrink-0" />
                    Going for CMMC Level 2?
                </h4>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss"
                    className="text-muted-foreground hover:text-foreground"
                >
                    <IconX className="h-4 w-4" />
                </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The free web app covers the 17 Level 1 practices. A desktop
                license unlocks all 110 NIST 800-171 requirements with SPRS
                scoring — and your data stays on your machine.
            </p>
            <div className="mt-3 flex items-center gap-4">
                <a
                    href={marketingUrl("prompt")}
                    target="_blank"
                    rel="noreferrer"
                    onClick={dismiss}
                    className={buttonClasses({ size: "sm" })}
                >
                    Buy a license
                </a>
                <button
                    type="button"
                    onClick={dismiss}
                    className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                    Maybe later
                </button>
            </div>
        </aside>
    );
};
