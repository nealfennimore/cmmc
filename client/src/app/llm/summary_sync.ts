"use client";
// Background reconciler that keeps the evidence_summaries store in step with
// the evidence_text store: it diffs the two by fingerprint and runs the
// map-reduce summarizer over whatever is missing or stale, one file at a
// time. Structurally a sibling of search/evidence_text_store.ts; progress is
// published through the subscribeLlmStatus listener idiom for React.
//
// Coordination with interactive work (the draft pipeline and the objective
// review) is an explicit pause API, not status polling: pauseSummarySync()
// aborts the in-progress file, awaits settlement, and holds the loop off
// until the returned release runs. The engine's "generating"/"loading"
// status is only a backstop check before each file.
//
// Multiple tabs can both summarize. Last write wins on identical content —
// the same accepted property as the extraction reconciler.

import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { ensureEvidenceTextSynced } from "@/app/search/evidence_text_store";
import { FREE_TIER } from "@/app/utils/tier";
import { getDeviceCapabilities } from "./capabilities";
import { resolveUsableModel } from "./config";
import {
    ensureLoaded,
    getLlmStatus,
    subscribeLlmStatus,
    weightsAvailable,
} from "./engine";
import { EvidenceDoc } from "./prompt";
import { ensureDocSummary, isCurrentSummary } from "./summarize";
import {
    getSelectedModelId,
    isAiEnabled,
    isAutoSummarizeEnabled,
} from "./settings";

export interface SummarySyncState {
    phase: "idle" | "running" | "paused";
    /** Evidence id of the file in progress — per-file buttons key on it. */
    evidenceId?: string;
    filename?: string;
    fileDone: number; // files completed / queued in this pass
    fileTotal: number;
    chunkDone?: number; // within the current file, from ensureDocSummary
    chunkTotal?: number;
}

// A stable module constant: getSummarySync doubles as the
// useSyncExternalStore server snapshot in a layout-mounted component, and
// referential stability avoids hydration loops.
const IDLE: SummarySyncState = { phase: "idle", fileDone: 0, fileTotal: 0 };

let state: SummarySyncState = IDLE;
const listeners = new Set<(state: SummarySyncState) => void>();

const setState = (next: SummarySyncState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
};

export const getSummarySync = (): SummarySyncState => state;

export const subscribeSummarySync = (
    listener: (state: SummarySyncState) => void,
): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// ---------------------------------------------------------------------------
// Pause API — interactive generation excludes the background loop.

let pauseCount = 0;
/** Callbacks parked in waitUntilFree; flushed by release and cancel. */
let wakeWaiters: (() => void)[] = [];
/** Abort + settlement handle for the file currently summarizing. */
let currentAbort: AbortController | null = null;
let currentRun: Promise<unknown> | null = null;
let cancelled = false;

const wake = () => {
    const waiters = wakeWaiters;
    wakeWaiters = [];
    waiters.forEach((waiter) => waiter());
};

/** Hold background summarization off while interactive generation runs.
 *  Aborts the current background chunk and awaits its settlement, so the
 *  caller can generate immediately after this resolves. The returned
 *  release is once-only; a fast no-op when nothing is running. */
export const pauseSummarySync = async (): Promise<() => void> => {
    pauseCount++;
    currentAbort?.abort();
    try {
        await currentRun;
    } catch {
        // The aborted file settles with AbortError; that is the point.
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        pauseCount--;
        if (pauseCount === 0) {
            wake();
        }
    };
};

/** Settle the pass and stay idle until the next trigger. */
export const cancelSummarySync = (): void => {
    cancelled = true;
    rerun = false;
    pendingManualIds = undefined;
    currentAbort?.abort();
    // Wake a pass parked in waitUntilFree so it can observe the flag.
    wake();
    if (!inFlight) {
        setState(IDLE);
    }
};

/** Grace after the worker frees up, so back-to-back interactive runs (the
 *  review loop generates once per objective) are not interleaved with
 *  background chunks. */
const GRACE_MS = 2000;

const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

const workerBusy = (): boolean => {
    const { phase } = getLlmStatus();
    return phase === "generating" || phase === "loading";
};

/** Block until no pause is held and the engine is not generating/loading,
 *  then a short grace delay. Returns early when the pass is cancelled. */
const waitUntilFree = async (): Promise<void> => {
    while (!cancelled && (pauseCount > 0 || workerBusy())) {
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
                // subscribeLlmStatus invokes the listener synchronously on
                // subscribe, before `unsubscribe` exists — defer a tick.
                queueMicrotask(() => unsubscribe());
            };
            wakeWaiters.push(finish);
            const unsubscribe = subscribeLlmStatus(() => {
                if (pauseCount === 0 && !workerBusy()) {
                    finish();
                }
            });
        });
        if (cancelled) {
            return;
        }
        await delay(GRACE_MS);
    }
};

// ---------------------------------------------------------------------------
// Reconciler.

let inFlight: Promise<void> | undefined;
let rerun = false;
/** Pending manual scope: undefined = no manual request; null = all evidence
 *  ids; a set = just those ids. Overlapping requests coalesce here and
 *  reconcile() consumes it. */
let pendingManualIds: Set<string> | null | undefined;

const requeueManual = (ids: Set<string> | null) => {
    if (ids === null || pendingManualIds === null) {
        pendingManualIds = null;
    } else if (pendingManualIds === undefined) {
        pendingManualIds = new Set(ids);
    } else {
        ids.forEach((id) => pendingManualIds!.add(id));
    }
};

const reconcile = async (): Promise<void> => {
    // Consume the manual request (if any) so triggers landing mid-pass
    // coalesce into the follow-up instead of being lost.
    const manualIds = pendingManualIds;
    const manual = manualIds !== undefined;
    pendingManualIds = undefined;

    // 1. Cheap gates first — this runs for every user on startup.
    if (
        FREE_TIER ||
        !isAiEnabled() ||
        (!manual && !isAutoSummarizeEnabled())
    ) {
        setState(IDLE);
        return;
    }

    // 2. Text current before the diff — also covers pages that never mount
    // the evidence UI. Rows it writes re-trigger one coalesced pass.
    await ensureEvidenceTextSynced();

    // 3. Resolve the model this device actually runs; weights are build-time
    // assets, so a missing bundle simply means no background work.
    const model = resolveUsableModel(
        getSelectedModelId(),
        await getDeviceCapabilities(),
    );
    if (!model || !(await weightsAvailable(model))) {
        setState(IDLE);
        return;
    }

    // 4. Orphan cleanup: summaries whose evidence is gone.
    const evidenceIds = new Set(
        (await IDB.evidence.getAllKeys()) as string[],
    );
    for (const row of await IDB.evidenceSummaries.getAll()) {
        if (!evidenceIds.has(row.evidence_id)) {
            await IDB.evidenceSummaries.delete(row.evidence_id);
        }
    }

    // 5. Queue readable files whose summary is missing, stale, or
    // incomplete. Ids only — texts are re-read per file in the loop.
    const summaryRows = new Map(
        (await IDB.evidenceSummaries.getAll()).map((row) => [
            row.evidence_id,
            row,
        ]),
    );
    const queue: string[] = [];
    for (const row of await IDB.evidenceText.getAll()) {
        if (row.status !== "ok" || !row.text.trim()) {
            continue;
        }
        if (!evidenceIds.has(row.id)) {
            continue;
        }
        if (manualIds instanceof Set && !manualIds.has(row.id)) {
            continue;
        }
        const cached = summaryRows.get(row.id);
        if (
            cached &&
            (await isCurrentSummary(cached, row.id)) &&
            cached.complete !== false &&
            cached.summary
        ) {
            continue;
        }
        queue.push(row.id);
    }
    if (!queue.length) {
        setState(IDLE);
        return;
    }

    // 6. Wait until no interactive work holds the engine…
    await waitUntilFree();
    if (cancelled) {
        setState(IDLE);
        return;
    }

    // 7. …and only now load the model.
    await ensureLoaded(model);

    // 8. One file at a time. Every gate is re-checked per file so a toggle,
    // deletion, or model switch mid-queue takes effect promptly.
    let fileDone = 0;
    const fileTotal = queue.length;
    for (const id of queue) {
        for (;;) {
            if (
                cancelled ||
                !isAiEnabled() ||
                (!manual && !isAutoSummarizeEnabled())
            ) {
                setState(IDLE);
                return;
            }
            const current = resolveUsableModel(
                getSelectedModelId(),
                await getDeviceCapabilities(),
            );
            if (!current || current.id !== model.id) {
                // Model changed: exit and re-run the pass under the new id.
                if (manual) {
                    requeueManual(manualIds ?? null);
                }
                rerun = true;
                setState(IDLE);
                return;
            }
            const [meta] = await IDB.evidence.getAll(IDBKeyRange.only(id));
            const [text] = await IDB.evidenceText.getAll(
                IDBKeyRange.only(id),
            );
            if (!meta || text?.status !== "ok" || !text.text.trim()) {
                break; // deleted or no longer readable — skip it
            }
            const doc: EvidenceDoc = {
                evidenceId: id,
                filename: meta.filename,
                text: text.text,
            };
            const aborter = new AbortController();
            currentAbort = aborter;
            setState({
                phase: "running",
                evidenceId: id,
                filename: meta.filename,
                fileDone,
                fileTotal,
            });
            try {
                const run = ensureDocSummary(doc, model.id, {
                    signal: aborter.signal,
                    onProgress: ({ done, total }) =>
                        setState({
                            phase: "running",
                            evidenceId: id,
                            filename: meta.filename,
                            fileDone,
                            fileTotal,
                            chunkDone: done,
                            chunkTotal: total,
                        }),
                });
                currentRun = run;
                await run;
                break; // file complete — next file
            } catch (error) {
                if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                ) {
                    if (cancelled) {
                        setState(IDLE);
                        return;
                    }
                    // Paused for interactive work: wait it out, then retry
                    // this file — per-chunk persistence resumes it.
                    setState({ phase: "paused", fileDone, fileTotal });
                    await waitUntilFree();
                    continue;
                }
                // Do not retry-loop a failing model.
                console.error("Evidence summary sync failed", error);
                setState(IDLE);
                return;
            } finally {
                currentAbort = null;
                currentRun = null;
            }
        }
        fileDone++;
    }
    setState(IDLE);
};

/** Run a reconcile pass; concurrent calls coalesce onto the running pass
 *  and trigger one follow-up so writes landing mid-pass are not missed.
 *  `manual: true` skips the auto-toggle gate (tier, AI-enabled, model, and
 *  weight gates still apply); `ids` restricts the manual pass to those
 *  evidence ids. */
export const ensureSummarySynced = (
    opts: { manual?: boolean; ids?: string[] } = {},
): Promise<void> => {
    if (opts.manual) {
        requeueManual(opts.ids ? new Set(opts.ids) : null);
    }
    if (inFlight) {
        rerun = true;
        return inFlight;
    }
    cancelled = false;
    inFlight = reconcile()
        .catch((error) =>
            console.error("Evidence summary sync failed", error),
        )
        .finally(() => {
            inFlight = undefined;
            if (rerun) {
                rerun = false;
                void ensureSummarySynced();
            }
        });
    return inFlight;
};

let started = false;

/**
 * Idempotent starter: one deferred startup pass plus a listener that
 * re-reconciles after extracted text lands. The evidenceText filter is
 * sufficient — evidence writes flow through extraction, which writes
 * evidenceText — and it prevents self-retriggering, because this module
 * writes only evidenceSummaries.
 */
export const startSummarySync = (): void => {
    if (started || FREE_TIER || typeof window === "undefined") {
        return;
    }
    started = true;

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => void ensureSummarySynced());
    } else {
        window.setTimeout(() => void ensureSummarySynced(), 2000);
    }

    let debounce: number | undefined;
    window.addEventListener(TABLE_CHANGED_EVENT, (event) => {
        const detail = (event as CustomEvent<{ table?: string }>).detail;
        if (detail?.table !== IDB.evidenceText.table) {
            return;
        }
        window.clearTimeout(debounce);
        debounce = window.setTimeout(
            () => void ensureSummarySynced(),
            1000,
        );
    });
};
