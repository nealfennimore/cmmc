"use client";
import { examineIdsForStoredItem } from "@/api/entities/ExamineItemIds";
import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks which "Examine" evidence types have been collected for a requirement.
 * This is a manual, self-attested checklist persisted in IndexedDB
 * (requirement_examine_items) — it is not linked to uploaded evidence
 * artifacts. Toggling writes through immediately.
 *
 * State lives in examine-id space (one row per frozen id); the checklist's
 * raw guide strings translate through examineIdsForStoredItem, so an item is
 * checked when every id it names is stored. Compound guide entries therefore
 * tick per document, and variant spellings of one document share a tick.
 */
export const useExamineChecklist = (requirementId: string) => {
    const [checkedIds, setCheckedIds] = useState<Set<string>>();
    // Authoritative copy so toggles never read a stale closure value.
    const ref = useRef<Set<string>>(new Set());

    useEffect(() => {
        let active = true;
        (async () => {
            const records = await IDB.requirementExamineItems.getAll(
                IDBKeyRange.only(requirementId),
                "requirement_id",
            );
            if (!active) {
                return;
            }
            const next = new Set(records.map((record) => record.examine_id));
            ref.current = next;
            setCheckedIds(next);
        })();
        return () => {
            active = false;
        };
    }, [requirementId]);

    const isChecked = useCallback(
        (item: string) =>
            !!checkedIds &&
            examineIdsForStoredItem(item).every((id) => checkedIds.has(id)),
        [checkedIds],
    );

    const toggle = useCallback(
        (item: string) => {
            const ids = examineIdsForStoredItem(item);
            const next = new Set(ref.current);
            const willCheck = !ids.every((id) => next.has(id));
            for (const id of ids) {
                if (willCheck) {
                    next.add(id);
                    IDB.requirementExamineItems.put({
                        requirement_id: requirementId,
                        examine_id: id,
                    });
                } else {
                    next.delete(id);
                    IDB.requirementExamineItems.delete([requirementId, id]);
                }
            }
            ref.current = next;
            setCheckedIds(next);
        },
        [requirementId],
    );

    return { isChecked, toggle };
};

/**
 * Examine ids (frozen slugs from examine-shared-items.json) evidenced for a
 * requirement: the tags of every artifact linked to it. The evidence-backed
 * complement to the manual checklist above — items whose id appears here are
 * shown as collected without a manual tick. Reloads on any evidence link/tag
 * write, so attaching or deleting evidence elsewhere on the page is
 * reflected immediately.
 */
export const useEvidencedExamineIds = (requirementId: string): Set<string> => {
    const [ids, setIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        let active = true;
        const load = async () => {
            const links = await IDB.evidenceRequirements.getAll(
                IDBKeyRange.only(requirementId),
                "requirement_id",
            );
            const tags = await Promise.all(
                links.map((link) =>
                    IDB.evidenceExamineItems.getAll(
                        IDBKeyRange.only(link.evidence_id),
                        "evidence_id",
                    ),
                ),
            );
            if (!active) {
                return;
            }
            setIds(new Set(tags.flat().map((tag) => tag.examine_id)));
        };
        load();

        const onTableChanged = (event: Event) => {
            const table = (event as CustomEvent<{ table: string }>).detail
                ?.table;
            if (
                table === IDB.evidenceRequirements.table ||
                table === IDB.evidenceExamineItems.table
            ) {
                load();
            }
        };
        window.addEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        return () => {
            active = false;
            window.removeEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        };
    }, [requirementId]);

    return ids;
};
