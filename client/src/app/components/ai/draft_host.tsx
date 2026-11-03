"use client";
// Root-layout host for background AI work: renders the draft panel or its
// minimized chip from the draft_job store, plus the background-summarization
// chip, in one bottom-docked container. Mounted once in layout.tsx so jobs
// survive client navigation. Also the global start point for the summary
// reconciler — unlike startEvidenceTextSync (started from evidence UI), the
// backfill must run on any page; the gates inside its reconcile pass keep
// this free for everyone else. No tier gate here: only SummarizeButton and
// the evidence table start work, and both already return null on FREE_TIER.

import { useEffect, useSyncExternalStore } from "react";
import {
    SummarySyncState,
    cancelSummarySync,
    getSummarySync,
    startSummarySync,
    subscribeSummarySync,
} from "@/app/llm/summary_sync";
import { startEmbedSync } from "@/app/llm/embed_sync";
import {
    DraftJobState,
    closeDraftJob,
    getDraftJob,
    restoreDraftJob,
    subscribeDraftJob,
} from "./draft_job";
import { DraftPanel } from "./draft_panel";
import { openAiSettings } from "./model_settings";

const getServerDraftJob = () => null;

const chipClasses =
    "flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-card-foreground shadow-lg";

const DraftChip = ({ job }: { job: DraftJobState }) => {
    const active = job.phase === "preparing" || job.phase === "generating";
    const requirementId = job.requirement.element_identifier;
    return (
        <div
            className={`${chipClasses} ${job.attention ? "ring-2 ring-primary" : ""}`}
        >
            <button
                type="button"
                onClick={restoreDraftJob}
                title="Restore the draft panel"
                className="flex min-w-0 items-center gap-2"
            >
                <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        active
                            ? "animate-pulse bg-primary"
                            : job.phase === "done"
                              ? "bg-green-500"
                              : "bg-red-500"
                    }`}
                />
                <span aria-live="polite" className="max-w-64 truncate">
                    {active
                        ? `${requirementId} — ${job.statusNote}`
                        : job.phase === "done"
                          ? "Draft ready"
                          : "Draft failed"}
                </span>
            </button>
            <button
                type="button"
                onClick={closeDraftJob}
                aria-label="Discard draft"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
                ✕
            </button>
        </div>
    );
};

const SummaryChip = ({ sync }: { sync: SummarySyncState }) => (
    <div className={chipClasses}>
        <button
            type="button"
            onClick={openAiSettings}
            title="Open AI Assistant settings"
            className="flex min-w-0 items-center gap-2"
        >
            <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                    sync.phase === "paused"
                        ? "bg-amber-500"
                        : "animate-pulse bg-primary"
                }`}
            />
            <span aria-live="polite" className="max-w-64 truncate">
                {sync.phase === "paused"
                    ? `Summarizing paused — ${sync.fileDone}/${sync.fileTotal}`
                    : `Summarizing evidence ${sync.fileDone + 1}/${sync.fileTotal} — ${sync.filename}` +
                      (sync.chunkTotal
                          ? ` (${(sync.chunkDone ?? 0) + 1}/${sync.chunkTotal})`
                          : "")}
            </span>
        </button>
        <button
            type="button"
            onClick={cancelSummarySync}
            aria-label="Cancel summarization"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
            ✕
        </button>
    </div>
);

export const DraftHost = () => {
    const job = useSyncExternalStore(
        subscribeDraftJob,
        getDraftJob,
        getServerDraftJob,
    );
    const sync = useSyncExternalStore(
        subscribeSummarySync,
        getSummarySync,
        getSummarySync,
    );
    useEffect(() => {
        startSummarySync();
        startEmbedSync();
    }, []);
    return (
        <>
            {job && !job.minimized && (
                <DraftPanel
                    key={`${job.requirement.element_identifier}:${job.focusId ?? ""}`}
                />
            )}
            {(job?.minimized || sync.phase !== "idle") && (
                <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2">
                    {job?.minimized && <DraftChip job={job} />}
                    {sync.phase !== "idle" && <SummaryChip sync={sync} />}
                </div>
            )}
        </>
    );
};
