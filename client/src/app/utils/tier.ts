// Build-time tier gating. The free public web build is limited to the 17
// CMMC Level 1 practices (FAR 52.204-21); everything else renders locked with
// an upgrade path to the desktop app. Desktop and local dev builds are always
// full-tier — the flag is only set by the web deploy job.

import { values } from "@/api/entities/RequirementValues";
import { Revision } from "@/app/context/revision";
import guideV2 from "../../../public/data/sp_800_171_2_0_0/assessment-guide-requirements.json";

/** Set via `NEXT_PUBLIC_TIER=free` (web deploy only; see deploy.yml). Inlined
 *  at build time, so locked state renders identically on server and client. */
export const FREE_TIER = process.env.NEXT_PUBLIC_TIER === "free";

export const isFreeTier = (): boolean => FREE_TIER;

/**
 * The 17 CMMC Level 1 practices by 800-171 Rev 2 requirement id.
 *
 * Hardcoded deliberately: the vendored assessment guide data misflags
 * 03.01.02 (`cui_data: false` despite FAR 52.204-21(b)(1)(ii)), and its FAR
 * key references miss 03.05.02 — no data-driven rule yields the right set.
 * The dev-mode check below flags drift if the data is ever regenerated.
 */
export const L1_REV2_IDS: readonly string[] = Object.freeze([
    "03.01.01",
    "03.01.02",
    "03.01.20",
    "03.01.22",
    "03.05.01",
    "03.05.02",
    "03.08.03",
    "03.10.01",
    "03.10.03",
    "03.10.04",
    "03.10.05",
    "03.13.01",
    "03.13.05",
    "03.14.01",
    "03.14.02",
    "03.14.04",
    "03.14.05",
]);

/**
 * The Rev 3 homes of the Level 1 practices: the same id where the control
 * survives in Rev 3, otherwise the `withdrawn_into` targets from values.json.
 */
export const L1_REV3_IDS: readonly string[] = Object.freeze(
    [
        ...L1_REV2_IDS.reduce((acc, id) => {
            const value = values[id];
            if (value?.revision?.includes(3)) {
                acc.add(id);
            } else {
                (value?.withdrawn_into ?? []).forEach((target) =>
                    acc.add(target),
                );
            }
            return acc;
        }, new Set<string>()),
    ].sort(),
);

// Union for lock gating: withdrawn L1 controls still render as withdrawn
// pages under /r3 and share IndexedDB keys with their Rev 2 counterparts, so
// they stay unlocked in both revisions. The per-revision lists above are only
// used as score-tile denominators.
const UNLOCKED = new Set<string>([...L1_REV2_IDS, ...L1_REV3_IDS]);

/** True when this requirement is usable in the current build. */
export const isUnlocked = (requirementId: string): boolean =>
    !FREE_TIER || UNLOCKED.has(requirementId);

/** True only on the free tier for requirements beyond Level 1. */
export const isLockedRequirement = (requirementId: string): boolean =>
    FREE_TIER && !UNLOCKED.has(requirementId);

/** Denominator set for the Level 1 progress tile. */
export const unlockedIdsForRevision = (
    revision: Revision,
): readonly string[] =>
    revision === Revision.V2 ? L1_REV2_IDS : L1_REV3_IDS;

// Drift check: warn (dev only) if the assessment guide's cui_data flags stop
// matching the hardcoded list, so a data regeneration can't silently change
// what the free tier unlocks. Known discrepancy today: 03.01.02.
if (process.env.NODE_ENV !== "production") {
    const flagged = new Set(
        guideV2.requirements
            .filter((requirement) => requirement.cui_data)
            .map((requirement) => requirement.export_id),
    );
    const missingFlag = L1_REV2_IDS.filter((id) => !flagged.has(id));
    const extraFlag = [...flagged].filter(
        (id) => !L1_REV2_IDS.includes(id),
    );
    const knownDiff =
        missingFlag.length === 1 &&
        missingFlag[0] === "03.01.02" &&
        extraFlag.length === 0;
    if (!knownDiff && (missingFlag.length || extraFlag.length)) {
        console.warn(
            "tier.ts: cui_data drift vs hardcoded L1 list — missing:",
            missingFlag,
            "extra:",
            extraFlag,
        );
    }
}
