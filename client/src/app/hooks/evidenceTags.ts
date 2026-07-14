"use client";
import { examineItemName } from "@/api/entities/ExamineItemIds";
import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { useSyncExternalStore } from "react";

// Module-level snapshot of every artifact's examine-tag names, shared by all
// badges. Reading it is synchronous, so an already-primed snapshot renders
// tagged evidence orange on the first paint — previously each badge ran its
// own IndexedDB query after mounting and flashed from neutral to tagged when
// it landed. The snapshot is primed on first subscribe, kept fresh via
// TABLE_CHANGED_EVENT, and retained across navigations (module scope), so
// only the very first mount in a session waits on the database.

const EMPTY_NAMES: string[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

let namesByEvidenceId = new Map<string, string[]>();
let taggedIds: ReadonlySet<string> = EMPTY_IDS;
let primed = false;
const listeners = new Set<() => void>();

const load = async () => {
    const tags = await IDB.evidenceExamineItems.getAll();
    const next = new Map<string, string[]>();
    for (const tag of tags) {
        const names = next.get(tag.evidence_id) ?? [];
        names.push(examineItemName(tag.examine_id) ?? tag.examine_id);
        next.set(tag.evidence_id, names);
    }
    next.forEach((names) => names.sort());
    namesByEvidenceId = next;
    taggedIds = new Set(next.keys());
    listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
    window.addEventListener(TABLE_CHANGED_EVENT, (event) => {
        const table = (event as CustomEvent<{ table: string }>).detail?.table;
        if (table === IDB.evidenceExamineItems.table) {
            load();
        }
    });
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!primed) {
        primed = true;
        load();
    }
    return () => {
        listeners.delete(listener);
    };
};

/** Names of the shared documents an artifact is tagged as. Synchronous read
 *  from the shared snapshot; stable references between reloads. */
export const useEvidenceTagNames = (evidenceId: string): string[] =>
    useSyncExternalStore(
        subscribe,
        () => namesByEvidenceId.get(evidenceId) ?? EMPTY_NAMES,
        () => EMPTY_NAMES,
    );

/** Every tagged artifact's id. Used by the badge list to float tagged
 *  evidence onto its own leading row. */
export const useTaggedEvidenceIds = (): ReadonlySet<string> =>
    useSyncExternalStore(
        subscribe,
        () => taggedIds,
        () => EMPTY_IDS,
    );
