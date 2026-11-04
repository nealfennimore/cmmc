"use client";
import { MODEL_CHANGED_EVENT } from "@/app/ai/model";
import { expectedReviewState } from "@/app/ai/review";
import { IDB, IDBObjectiveReview, TABLE_CHANGED_EVENT } from "@/app/db";
import { SUMMARY_CONTEXT_CHANGED_EVENT } from "@/app/llm/settings";
import { useCallback, useEffect, useState } from "react";

// Tables whose writes can change either the stored reviews or the expected
// fingerprint they are compared against.
const WATCHED_TABLES = new Set<string>([
    IDB.objectiveReviews.table,
    IDB.evidence.table,
    IDB.evidenceRequirements.table,
    IDB.evidenceText.table,
    // A summary that appears or changes enters the fingerprint.
    IDB.evidenceSummaries.table,
]);

export interface ObjectiveReviewsState {
    /** Stored rows for the requirement, keyed by objective id. */
    reviews: Map<string, IDBObjectiveReview>;
    /** True when any stored row no longer matches the current evidence set,
     *  pipeline versions, or model. */
    stale: boolean;
    /** Linked artifacts with no extractable text. */
    unreadable: number;
}

/** Stored objective reviews plus a staleness verdict, kept fresh across
 *  evidence writes, review runs, and model registration. */
export const useObjectiveReviews = (
    requirementId: string,
): ObjectiveReviewsState => {
    const [reviews, setReviews] = useState<Map<string, IDBObjectiveReview>>(
        new Map(),
    );
    const [expected, setExpected] = useState<string | undefined>();
    const [unreadable, setUnreadable] = useState(0);

    const refresh = useCallback(async () => {
        const rows = await IDB.objectiveReviews.getAll(
            IDBKeyRange.only(requirementId),
            "requirement_id",
        );
        setReviews(new Map(rows.map((row) => [row.objective_id, row])));
        const state = await expectedReviewState(requirementId);
        setExpected(state.fingerprint);
        setUnreadable(state.unreadable);
    }, [requirementId]);

    useEffect(() => {
        refresh();
        // Debounced: extraction backfills and review runs write row by row.
        let debounce: number | undefined;
        const schedule = () => {
            window.clearTimeout(debounce);
            debounce = window.setTimeout(() => void refresh(), 200);
        };
        const onTableChanged = (event: Event) => {
            const table = (event as CustomEvent<{ table?: string }>).detail
                ?.table;
            if (table && WATCHED_TABLES.has(table)) {
                schedule();
            }
        };
        window.addEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        window.addEventListener(MODEL_CHANGED_EVENT, schedule);
        window.addEventListener(SUMMARY_CONTEXT_CHANGED_EVENT, schedule);
        return () => {
            window.removeEventListener(SUMMARY_CONTEXT_CHANGED_EVENT, schedule);
            window.clearTimeout(debounce);
            window.removeEventListener(TABLE_CHANGED_EVENT, onTableChanged);
            window.removeEventListener(MODEL_CHANGED_EVENT, schedule);
        };
    }, [refresh]);

    const stale =
        reviews.size > 0 &&
        expected !== undefined &&
        [...reviews.values()].some((row) => row.fingerprint !== expected);

    return { reviews, stale, unreadable };
};
