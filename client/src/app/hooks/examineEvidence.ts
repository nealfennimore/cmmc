"use client";
import { IDB } from "@/app/db";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks which "Examine" evidence types have been collected for a requirement.
 * This is a manual, self-attested checklist persisted in IndexedDB — it is not
 * linked to uploaded evidence artifacts. Toggling writes through immediately.
 */
export const useExamineEvidence = (requirementId: string) => {
    const [checked, setChecked] = useState<Set<string>>();
    // Authoritative copy so toggles never read a stale closure value.
    const ref = useRef<Set<string>>(new Set());

    useEffect(() => {
        let active = true;
        (async () => {
            const records = await IDB.examineEvidence.getAll(
                IDBKeyRange.only(requirementId),
                "requirement_id",
            );
            if (!active) {
                return;
            }
            const next = new Set(records.map((record) => record.item));
            ref.current = next;
            setChecked(next);
        })();
        return () => {
            active = false;
        };
    }, [requirementId]);

    const toggle = useCallback(
        (item: string) => {
            const next = new Set(ref.current);
            const willCheck = !next.has(item);
            if (willCheck) {
                next.add(item);
                IDB.examineEvidence.put({ requirement_id: requirementId, item });
            } else {
                next.delete(item);
                IDB.examineEvidence.delete([requirementId, item]);
            }
            ref.current = next;
            setChecked(next);
        },
        [requirementId],
    );

    return { checked, toggle };
};
