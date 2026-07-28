"use client";
import { getEvidenceData, IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { EXTRACTOR_VERSION, extractEvidenceText } from "./extract_text";

// Keeps the evidence_text store in step with the evidence store by diffing
// the two and extracting whatever is missing or stale. Reconciling from the
// stores (instead of hooking each upload path) covers every way evidence
// changes — file upload, clipboard paste, URL form, replace, import — plus
// the one-time backfill of a pre-v10 corpus, all through the same pass.

let inFlight: Promise<void> | undefined;
let rerun = false;

const reconcile = async (): Promise<void> => {
    const evidenceIds = (await IDB.evidence.getAllKeys()) as string[];
    const rows = await IDB.evidenceText.getAll();

    const evidenceSet = new Set(evidenceIds);
    for (const row of rows) {
        if (!evidenceSet.has(row.id)) {
            await IDB.evidenceText.delete(row.id);
        }
    }

    const rowById = new Map(rows.map((row) => [row.id, row]));
    for (const id of evidenceIds) {
        const existing = rowById.get(id);
        if (existing && existing.extractor >= EXTRACTOR_VERSION) {
            continue;
        }
        // One artifact at a time: blobs stay out of memory except the one
        // being extracted, and the awaits yield between files so the UI
        // never stalls behind a large backfill.
        const [artifact] = await IDB.evidence.getAll(IDBKeyRange.only(id));
        if (!artifact) {
            continue;
        }
        const data = await getEvidenceData(id);
        if (!data) {
            // Metadata without a payload — record it so the row isn't
            // retried on every load.
            await IDB.evidenceText.put({
                id,
                text: "",
                status: "error",
                extractor: EXTRACTOR_VERSION,
                bytes: artifact.bytes,
            });
            continue;
        }
        await IDB.evidenceText.put(
            await extractEvidenceText({ ...artifact, data }),
        );
    }
};

/** Run a reconcile pass; concurrent calls coalesce onto the running pass and
 *  trigger one follow-up so writes landing mid-pass are not missed. */
export const ensureEvidenceTextSynced = (): Promise<void> => {
    if (inFlight) {
        rerun = true;
        return inFlight;
    }
    inFlight = reconcile()
        .catch((error) => console.error("Evidence text sync failed", error))
        .finally(() => {
            inFlight = undefined;
            if (rerun) {
                rerun = false;
                void ensureEvidenceTextSynced();
            }
        });
    return inFlight;
};

let started = false;

/**
 * Idempotent starter: one deferred startup pass plus a listener that
 * re-reconciles after evidence writes. Called from the components that show
 * or mutate evidence rather than the root layout, so pages without evidence
 * never pay for extraction.
 */
export const startEvidenceTextSync = (): void => {
    if (started || typeof window === "undefined") {
        return;
    }
    started = true;

    // Defer the startup pass off the critical path; extraction lazy-loads
    // pdf.js/exceljs, which shouldn't compete with hydration.
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => void ensureEvidenceTextSynced());
    } else {
        window.setTimeout(() => void ensureEvidenceTextSynced(), 2000);
    }

    let debounce: number | undefined;
    window.addEventListener(TABLE_CHANGED_EVENT, (event) => {
        const detail = (event as CustomEvent<{ table?: string }>).detail;
        // Only artifact writes: the reconciler's own evidence_text puts fire
        // this event too, and reacting to those would loop forever.
        if (detail?.table !== IDB.evidence.table) {
            return;
        }
        window.clearTimeout(debounce);
        debounce = window.setTimeout(
            () => void ensureEvidenceTextSynced(),
            1000,
        );
    });
};
