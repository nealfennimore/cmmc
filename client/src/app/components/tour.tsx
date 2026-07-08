"use client";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { usePathname, useRouter } from "next/navigation";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { Button, menuItemClasses } from "./ui";

// The tour spans two pages (the family list and a requirement page) and
// survives the navigation between them by keeping the current step in
// sessionStorage; every page mounts a <Tour /> via <Navigation />, so the
// component on the next page picks the tour back up.
const STEP_KEY = "cmmc.tour.step";
const ARRIVED_KEY = "cmmc.tour.arrived";
const SEEN_KEY = "cmmc.tour.seen";
const START_EVENT = "cmmc:tour-start";

/** Requirement used for the walkthrough; present in both Rev 2 and Rev 3. */
const TOUR_REQUIREMENT = "03.01.01";

interface TourStep {
    page: "home" | "requirement";
    /** Matches a data-tour attribute; steps without one render centered. */
    target?: string;
    title: string;
    body: ReactNode;
}

const STEPS: TourStep[] = [
    {
        page: "home",
        title: "Welcome 👋",
        body: "This app helps you document NIST 800-171 / CMMC compliance: record an implementation status and notes for every security requirement, attach evidence, and generate a System Security Plan and POA&M. Everything is stored locally on this device — no accounts, no servers.",
    },
    {
        page: "home",
        target: "families",
        title: "Requirement families",
        body: "The 800-171 controls are grouped into families. Click a family to drill into its requirements. The icons in front of each one show its rolled-up status and evidence at a glance — here's what they mean.",
    },
    {
        page: "home",
        target: "families",
        title: "Status & evidence icons",
        body: (
            <>
                <p className="mb-2">
                    Every family, requirement, and control carries a status
                    icon. A family reflects the requirements beneath it — for
                    example, one not-implemented control turns the whole family
                    and requirement red.
                </p>
                <ul className="flex flex-col gap-1">
                    <li>🟢 Implemented</li>
                    <li>🟡 Partially implemented</li>
                    <li>🔴 Not implemented</li>
                    <li>⚫ Not applicable</li>
                    <li>⚪ Not started (the default)</li>
                    <li>🚧 Started, but work remaining beneath</li>
                    <li>🧾 Evidence has been attached</li>
                </ul>
            </>
        ),
    },
    {
        page: "home",
        target: "revision-switch",
        title: "Switch revisions",
        body: "Toggle between 800-171 Rev 2 and Rev 3 at any time — CMMC assessments currently use Rev 2, and Rev 3 lets you get ahead of the transition. The switch keeps your place, jumping to the matching control where one exists.",
    },
    {
        page: "home",
        target: "sprs-score",
        title: "Live SPRS score",
        body: "Your estimated SPRS score (out of 110) updates as you record statuses. On Rev 3 it is estimated by mapping withdrawn Rev 2 control values into their Rev 3 replacements.",
    },
    {
        page: "home",
        target: "overview",
        title: "Overview tree",
        body: "Open a bird's-eye view of every family, requirement, and control with their statuses — useful for spotting gaps and jumping anywhere quickly.",
    },
    {
        page: "home",
        target: "menu",
        title: "Reports, POA&M, and backups",
        body: "From this menu you can generate a markdown report of all statuses and notes (great for an SSP), a POA&M CSV of gap items, and export or import your entire database — important, since your data never leaves this device. You can also restart this tour from here anytime.",
    },
    {
        page: "home",
        target: "menu",
        title: "Evidence tools",
        body: (
            <>
                <p className="mb-2">
                    The menu also gathers everything evidence-related:
                </p>
                <ul className="flex flex-col gap-1">
                    <li>
                        <strong>View Evidence</strong> — review every attached
                        artifact in one place.
                    </li>
                    <li>
                        <strong>Export Evidence</strong> — download all stored
                        evidence files to your device in one go.
                    </li>
                    <li>
                        <strong>Download Evidence Map</strong> — generate a
                        JSON file mapping each artifact, with its content hash,
                        to the requirements it supports — handy to hand to an
                        assessor alongside the exported files.
                    </li>
                </ul>
            </>
        ),
    },
    {
        page: "requirement",
        target: "discussion",
        title: "A requirement page",
        body: "Let's look at 03.01.01, the first Access Control requirement. Each requirement page opens with NIST's discussion of the control in plain language, with links to related controls.",
    },
    {
        page: "requirement",
        target: "control-values",
        title: "Control value",
        body: "Every control shows its CMMC point value and whether an unmet control can be deferred to a POA&M. Controls that cannot be POA&M-ed must be implemented to achieve CMMC Level 2 certification.",
    },
    {
        page: "requirement",
        target: "assessment-guidance",
        title: "Assessment guidance (Rev 2)",
        body: "This panel explains how an assessor determines the requirement is met — the Examine, Interview, and Test methods, questions an assessor may ask, and a checklist where you tick off the evidence types you have actually collected.",
    },
    {
        page: "requirement",
        target: "evidence",
        title: "Attach evidence",
        body: "Back up your requirements with evidence: drop in files, paste images from your clipboard, add URLs, or reuse evidence already attached to another requirement. Right-click a badge to rename or replace it. Click on the evidence to preview it.",
    },
    {
        page: "requirement",
        target: "requirement-form",
        title: "Record your implementation",
        body: "Set a status for each security requirement and describe how you meet it in the notes — markdown is supported. These statuses and notes are exactly what the generated report is built from.",
    },
    {
        page: "requirement",
        target: "save",
        title: "Saving",
        body: "Changes save automatically as you type (Ctrl+S and the Save button work too), straight into your browser's local database.",
    },
    {
        page: "requirement",
        target: "content-navigation",
        title: "Work through in order",
        body: "Use the previous / next buttons to step through every requirement in sequence — they continue into the next family, so you can work the whole framework front to back.",
    },
    {
        page: "requirement",
        title: "That's the tour!",
        body: "Pick a family and start recording where you stand — the score, rollup icons, and reports will follow along. You can restart this tour anytime from the upper-right menu.",
    },
];

export function startTour() {
    try {
        window.sessionStorage.setItem(STEP_KEY, "0");
        window.sessionStorage.removeItem(ARRIVED_KEY);
        window.localStorage.setItem(SEEN_KEY, "1");
    } catch {}
    window.dispatchEvent(new Event(START_EVENT));
}

export const TourMenuItem = () => (
    <button
        className={menuItemClasses()}
        tabIndex={100}
        onClick={() => {
            startTour();
            // The nav menu's outside-click handler ignores this click (it is
            // inside the menu), so dispatch a fresh one from body to close it.
            document.body.click();
        }}
    >
        Take a Tour
        <svg
            className="w-5 h-5"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
        </svg>
    </button>
);

type Rect = { top: number; left: number; width: number; height: number };

const normalize = (p: string) => p.replace(/\/+$/, "") || "/";

export const Tour = () => {
    const revision = useRevisionContext();
    const base = toPath(revision);
    const router = useRouter();
    const pathname = usePathname();
    const [mounted, setMounted] = useState(false);
    const [step, setStep] = useState<number | null>(null);
    const [el, setEl] = useState<Element | null>(null);
    const [rect, setRect] = useState<Rect | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const direction = useRef(1);

    const pageFor = (page: TourStep["page"]) =>
        page === "home" ? base : `${base}/requirement/${TOUR_REQUIREMENT}`;

    // The site root serves the Rev 2 home page in addition to /r2, so both
    // count as "home" — otherwise the tour would redirect / to /r2.
    const onPage = (page: TourStep["page"]) =>
        normalize(pathname) === normalize(pageFor(page)) ||
        (page === "home" && normalize(pathname) === "/");

    const end = () => {
        try {
            window.sessionStorage.removeItem(STEP_KEY);
            window.sessionStorage.removeItem(ARRIVED_KEY);
            window.localStorage.setItem(SEEN_KEY, "1");
        } catch {}
        setStep(null);
        setEl(null);
        setRect(null);
    };

    const goTo = (next: number) => {
        if (next < 0) {
            return;
        }
        if (next >= STEPS.length) {
            return end();
        }
        direction.current = next > (step ?? 0) ? 1 : -1;
        try {
            window.sessionStorage.setItem(STEP_KEY, String(next));
        } catch {}
        setEl(null);
        setRect(null);
        setStep(next);
    };

    // Resume a tour in progress, or offer one on the first visit.
    useEffect(() => {
        setMounted(true);
        let saved: string | null = null;
        let seen: string | null = null;
        try {
            saved = window.sessionStorage.getItem(STEP_KEY);
            seen = window.localStorage.getItem(SEEN_KEY);
        } catch {}
        const savedStep = saved === null ? NaN : parseInt(saved, 10);
        if (!Number.isNaN(savedStep)) {
            setStep(Math.min(Math.max(savedStep, 0), STEPS.length - 1));
        } else if (!seen) {
            setShowPrompt(true);
        }
        const onStart = () => {
            direction.current = 1;
            setShowPrompt(false);
            setEl(null);
            setRect(null);
            setStep(0);
        };
        window.addEventListener(START_EVENT, onStart);
        return () => window.removeEventListener(START_EVENT, onStart);
    }, []);

    // Put the active step on screen: navigate to its page if needed, then
    // wait for its target element to render.
    useEffect(() => {
        if (step === null) {
            return;
        }
        const s = STEPS[step];
        let arrived: string | null = null;
        try {
            arrived = window.sessionStorage.getItem(ARRIVED_KEY);
        } catch {}
        if (!onPage(s.page)) {
            // Navigate to the step's page once. Mismatching again after we
            // already arrived means the user struck out on their own —
            // let them go rather than yanking them back.
            if (arrived === String(step)) {
                return end();
            }
            try {
                window.sessionStorage.setItem(ARRIVED_KEY, String(step));
            } catch {}
            router.push(pageFor(s.page));
            return;
        }
        try {
            window.sessionStorage.setItem(ARRIVED_KEY, String(step));
        } catch {}
        if (!s.target) {
            setEl(null);
            return;
        }
        let cancelled = false;
        let tries = 0;
        const find = () => {
            if (cancelled) {
                return;
            }
            const node = document.querySelector(`[data-tour="${s.target}"]`);
            if (node) {
                if (node instanceof HTMLDetailsElement) {
                    node.open = true;
                }
                node.scrollIntoView({ block: "center", behavior: "smooth" });
                setEl(node);
            } else if (++tries > 20) {
                // Target never rendered (e.g. the Rev 2–only guidance panel
                // while touring Rev 3) — skip past it in the direction of
                // travel so Back and Next both work.
                goTo(step + direction.current);
            } else {
                setTimeout(find, 150);
            }
        };
        find();
        return () => {
            cancelled = true;
        };
    }, [step, pathname]);

    // Keep the spotlight glued to the target through scrolling, window
    // resizes, and layout shifts.
    useEffect(() => {
        if (!el) {
            setRect(null);
            return;
        }
        let raf: number;
        const track = () => {
            const r = el.getBoundingClientRect();
            setRect((prev) =>
                prev &&
                prev.top === r.top &&
                prev.left === r.left &&
                prev.width === r.width &&
                prev.height === r.height
                    ? prev
                    : {
                          top: r.top,
                          left: r.left,
                          width: r.width,
                          height: r.height,
                      },
            );
            raf = requestAnimationFrame(track);
        };
        raf = requestAnimationFrame(track);
        return () => cancelAnimationFrame(raf);
    }, [el]);

    useEffect(() => {
        if (step === null) {
            return;
        }
        const onKeyDown = (e: KeyboardEvent) => {
            // The page stays interactive during the tour; don't hijack keys
            // while the user is typing in a field.
            const nodeName = (e.target as HTMLElement)?.nodeName;
            if (["INPUT", "TEXTAREA", "SELECT"].includes(nodeName)) {
                return;
            }
            if (e.key === "Escape") {
                end();
            } else if (e.key === "ArrowRight") {
                goTo(step + 1);
            } else if (e.key === "ArrowLeft") {
                goTo(step - 1);
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [step]);

    if (!mounted) {
        return null;
    }

    const active = step !== null ? STEPS[step] : null;

    const cardStyle: CSSProperties = (() => {
        if (!active?.target || !rect) {
            return {};
        }
        const margin = 16;
        const width = Math.min(380, window.innerWidth - margin * 2);
        const left = Math.min(
            Math.max(margin, rect.left),
            window.innerWidth - width - margin,
        );
        const spaceBelow = window.innerHeight - (rect.top + rect.height);
        if (spaceBelow > 260) {
            return { width, left, top: rect.top + rect.height + 18 };
        }
        if (rect.top > 260) {
            return {
                width,
                left,
                top: rect.top - 18,
                transform: "translateY(-100%)",
            };
        }
        // The target fills the viewport (e.g. the whole form); pin the card
        // to the bottom edge instead of covering it.
        return {
            width,
            left,
            top: window.innerHeight - margin,
            transform: "translateY(-100%)",
        };
    })();

    const card = active && (
        <>
            <div className="flex items-start justify-between gap-4 px-5 pt-4">
                <h2 className="text-base font-semibold tracking-tight">
                    {active.title}
                </h2>
                <button
                    onClick={end}
                    aria-label="End tour"
                    className="-mr-1 rounded-md p-1 leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                    ✕
                </button>
            </div>
            <div className="px-5 py-3 text-sm leading-6 text-muted-foreground">
                {active.body}
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
                <span className="text-xs text-muted-foreground">
                    {step! + 1} of {STEPS.length}
                </span>
                <div className="flex gap-2">
                    {step! > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => goTo(step! - 1)}
                        >
                            Back
                        </Button>
                    )}
                    <Button size="sm" onClick={() => goTo(step! + 1)}>
                        {step === STEPS.length - 1 ? "Finish" : "Next"}
                    </Button>
                </div>
            </div>
        </>
    );

    return (
        <>
            {showPrompt && step === null && onPage("home") && (
                <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg">
                    <p className="mb-3 text-sm">
                        👋 First time here? Take a quick tour of how to document
                        your 800-171 compliance.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setShowPrompt(false);
                                try {
                                    window.localStorage.setItem(SEEN_KEY, "1");
                                } catch {}
                            }}
                        >
                            No thanks
                        </Button>
                        <Button size="sm" onClick={startTour}>
                            Start tour
                        </Button>
                    </div>
                </div>
            )}
            {active &&
                (active.target && rect ? (
                    // Spotlight ring; the huge box-shadow dims everything else.
                    // pointer-events stays off so the page remains usable.
                    <div
                        className="pointer-events-none fixed z-[70] rounded-lg transition-all duration-200 ease-out"
                        style={{
                            top: rect.top - 6,
                            left: rect.left - 6,
                            width: rect.width + 12,
                            height: rect.height + 12,
                            boxShadow:
                                "0 0 0 3px rgba(59,130,246,0.7), 0 0 0 100vmax rgba(15,23,42,0.5)",
                        }}
                    />
                ) : (
                    <div className="pointer-events-none fixed inset-0 z-[70] bg-slate-900/50" />
                ))}
            {active &&
                (active.target ? (
                    rect && (
                        <div
                            className="fixed z-[71] rounded-lg border border-border bg-card text-card-foreground shadow-xl"
                            style={cardStyle}
                        >
                            {card}
                        </div>
                    )
                ) : (
                    <div className="pointer-events-none fixed inset-0 z-[71] flex items-center justify-center p-4">
                        <div className="pointer-events-auto w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-xl">
                            {card}
                        </div>
                    </div>
                ))}
        </>
    );
};
