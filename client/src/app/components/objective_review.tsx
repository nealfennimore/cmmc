"use client";
// Per-objective AI evidence review panel on the requirement page, modeled on
// assessment_guidance.tsx. Renders when the requirement has assessment
// objectives and either stored verdicts exist (shown even with the AI
// feature off) or a local model is available to run one — the free web
// build never registers a model, so the panel is desktop-only for now.

import { LocalModel, MODEL_CHANGED_EVENT, getLocalModel } from "@/app/ai/model";
import { ReviewObjective, objectivesForRequirement } from "@/app/ai/objectives";
import { ReviewProgress, reviewRequirement } from "@/app/ai/review";
import { useRevisionContext } from "@/app/context/revision";
import { IDBObjectiveReview } from "@/app/db";
import { useObjectiveReviews } from "@/app/hooks/objectiveReviews";
import { getDeviceCapabilities } from "@/app/llm/capabilities";
import { resolveUsableModel } from "@/app/llm/config";
import {
    ensureLoaded,
    subscribeLlmStatus,
    weightsAvailable,
} from "@/app/llm/engine";
import { getSelectedModelId, isAiEnabled } from "@/app/llm/settings";
import { isUnlocked } from "@/app/utils/tier";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown } from "./icons";
import { Badge, BadgeVariant, Button } from "./ui";

/** Tracks the registered model so the panel appears the moment weights
 *  finish loading. */
const useLocalModel = (): LocalModel | undefined => {
    const [model, setModel] = useState<LocalModel | undefined>(getLocalModel);
    useEffect(() => {
        const onChange = () => setModel(getLocalModel());
        window.addEventListener(MODEL_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(MODEL_CHANGED_EVENT, onChange);
    }, []);
    return model;
};

const VERDICT_BADGES: Record<
    IDBObjectiveReview["verdict"],
    { label: string; variant: BadgeVariant }
> = {
    met: { label: "Met", variant: "success" },
    "partially-met": { label: "Partially met", variant: "warning" },
    "not-met": { label: "Not met", variant: "danger" },
    "no-evidence": { label: "No evidence", variant: "neutral" },
    unparsed: { label: "Unparsed", variant: "neutral" },
    error: { label: "Error", variant: "neutral" },
};

const ObjectiveRow = ({
    objective,
    review,
}: {
    objective: ReviewObjective;
    review?: IDBObjectiveReview;
}) => {
    const badge = review && VERDICT_BADGES[review.verdict];
    return (
        <li className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
                <a href={`#${objective.anchorId}`}>
                    <Badge variant="neutral">{objective.citation}</Badge>
                </a>
                {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
                <span className="text-sm leading-relaxed text-foreground">
                    {objective.text}
                </span>
            </div>
            {review?.reason && (
                <p
                    className={`text-sm leading-relaxed ${
                        review.verdict === "error"
                            ? "text-red-600"
                            : "text-muted-foreground"
                    }`}
                >
                    {review.reason}
                </p>
            )}
            {review?.quote && (
                <blockquote className="rounded-md border-l-2 border-border bg-secondary px-3 py-2 text-sm leading-relaxed">
                    “{review.quote.text}”
                    <span className="mt-1 block text-xs text-muted-foreground">
                        {review.quote.evidence_id ? (
                            <a
                                href={`#evidence-${review.quote.evidence_id}`}
                                className="hover:underline"
                            >
                                {review.quote.filename}
                            </a>
                        ) : (
                            review.quote.filename
                        )}
                        {!review.quote.verified && (
                            <span className="ml-2 italic">
                                unverified — not found in the evidence text
                            </span>
                        )}
                    </span>
                </blockquote>
            )}
            {review?.verdict === "unparsed" && (
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                        Show the model&apos;s raw output
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-input bg-surface px-3 py-2 font-mono text-xs">
                        {review.raw}
                    </pre>
                </details>
            )}
        </li>
    );
};

export const ObjectiveReview = ({
    requirementId,
    locked,
}: {
    requirementId: string;
    locked?: boolean;
}) => {
    const revision = useRevisionContext();
    const model = useLocalModel();
    const objectives = useMemo(
        () => objectivesForRequirement(revision, requirementId),
        [revision, requirementId],
    );
    const { reviews, stale, unreadable } = useObjectiveReviews(requirementId);

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<ReviewProgress | null>(null);
    const [loadNote, setLoadNote] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // True when this build bundles usable weights for the selected model, so
    // the panel can offer to load the engine itself instead of staying
    // hidden until the draft feature loads it (same probe as
    // summarize_button.tsx; weights cannot appear while the page is open).
    const [weightsReady, setWeightsReady] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const capabilities = await getDeviceCapabilities();
            // The selection falls back to the default model when this device
            // cannot run it — the review must stay available either way.
            const resolved = resolveUsableModel(
                getSelectedModelId(),
                capabilities,
            );
            const ready =
                resolved !== null && (await weightsAvailable(resolved));
            if (!cancelled) {
                setWeightsReady(ready);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(
        () =>
            subscribeLlmStatus((status) => {
                setLoadNote(
                    status.phase === "loading"
                        ? `Loading model… ${Math.round((status.progress ?? 0) * 100)}%`
                        : null,
                );
            }),
        [],
    );

    const reviewed = objectives.some((objective) => reviews.has(objective.id));
    // Runnable = the feature is on and an engine is (or can be) loaded.
    // Stored verdicts render either way — generated artifacts stay visible
    // when the AI feature is off; only generating anew is gated.
    const runnable =
        isAiEnabled() && (model !== undefined || weightsReady);
    if (
        !objectives.length ||
        !isUnlocked(requirementId) ||
        (!runnable && !reviewed)
    ) {
        return null;
    }

    const run = async () => {
        setRunning(true);
        setError(null);
        setProgress(null);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            // Load the engine on first use; it registers the LocalModel and
            // stays loaded for later runs (and for the draft feature).
            if (!getLocalModel()) {
                const resolved = resolveUsableModel(
                    getSelectedModelId(),
                    await getDeviceCapabilities(),
                );
                if (!resolved) {
                    throw new Error("No model can run on this device.");
                }
                await ensureLoaded(resolved);
            }
            await reviewRequirement(revision, requirementId, {
                signal: controller.signal,
                onProgress: setProgress,
            });
        } catch (runError) {
            setError(
                runError instanceof Error ? runError.message : String(runError),
            );
        } finally {
            abortRef.current = null;
            setRunning(false);
            setProgress(null);
        }
    };

    const met = objectives.filter(
        (objective) => reviews.get(objective.id)?.verdict === "met",
    ).length;

    return (
        <details
            className="mb-6 w-full rounded-lg border border-border bg-card text-card-foreground shadow-sm"
            data-tour="evidence-review"
        >
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 font-semibold tracking-tight marker:content-none hover:bg-secondary">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="h-4 text-primary"
                    aria-hidden="true"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
                    />
                </svg>
                <span className="flex-1">Evidence Review (AI)</span>
                <Badge variant="warning" className="font-normal normal-case">
                    Beta
                </Badge>
                {stale && (
                    <Badge
                        variant="warning"
                        className="font-normal normal-case"
                    >
                        Stale
                    </Badge>
                )}
                {reviewed && (
                    <Badge
                        variant={
                            met === objectives.length ? "success" : "neutral"
                        }
                        className="font-normal normal-case"
                    >
                        Met {met}/{objectives.length}
                    </Badge>
                )}
                <IconChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            </summary>

            <div className="border-t border-border px-4 py-4">
                <p className="mb-3 text-xs text-muted-foreground">
                    Beta: generated locally by a small on-device model from
                    the evidence attached to this requirement, and it can be
                    wrong — verdicts, reasons, and quotes may be inaccurate or
                    inconsistent between runs. Assessor guidance, not an
                    assessment — verify every verdict yourself.
                </p>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={locked || running || !runnable}
                        title={
                            locked
                                ? "Not available for locked requirements"
                                : !runnable
                                  ? "Enable AI features in the AI Assistant settings to run a review"
                                  : undefined
                        }
                        onClick={run}
                    >
                        {running
                            ? "Reviewing…"
                            : reviewed
                              ? "Re-run review"
                              : "Run review"}
                    </Button>
                    {running && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => abortRef.current?.abort()}
                            >
                                Stop
                            </Button>
                            <span
                                aria-live="polite"
                                className="text-sm text-muted-foreground"
                            >
                                {loadNote ??
                                    (progress
                                        ? `Objective ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                                        : "Preparing…")}
                            </span>
                        </>
                    )}
                    {error && (
                        <span role="alert" className="text-sm text-red-600">
                            {error}
                        </span>
                    )}
                </div>

                {unreadable > 0 && (
                    <p className="mb-3 text-xs italic text-muted-foreground">
                        {unreadable} linked file{unreadable === 1 ? "" : "s"}{" "}
                        had no extractable text and{" "}
                        {unreadable === 1 ? "was" : "were"} not reviewed.
                    </p>
                )}

                <ul className="flex flex-col">
                    {objectives.map((objective) => (
                        <ObjectiveRow
                            key={objective.id}
                            objective={objective}
                            review={reviews.get(objective.id)}
                        />
                    ))}
                </ul>
            </div>
        </details>
    );
};
