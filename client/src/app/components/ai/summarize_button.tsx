"use client";
// Entry point for the evidence summarizer on the requirement detail page.
// Renders nothing on the free web tier. When weights are missing it opens
// the AI settings modal instead of starting a draft. The draft itself runs
// in the module-level draft_job store; DraftHost (root layout) renders the
// panel or its minimized chip, so this button only starts or restores jobs.

import { ElementWrapper } from "@/api/entities/Framework";
import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { resolveUsableModel } from "@/app/llm/config";
import { getDeviceCapabilities } from "@/app/llm/capabilities";
import { weightsAvailable } from "@/app/llm/engine";
import { getSelectedModelId, isAiEnabled } from "@/app/llm/settings";
import { FREE_TIER } from "@/app/utils/tier";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../ui";
import {
    getDraftJob,
    isDraftJobActive,
    restoreDraftJob,
    startDraftJob,
    subscribeDraftJob,
} from "./draft_job";
import { openAiSettings } from "./model_settings";

const getServerDraftJob = () => null;

export const SummarizeButton = ({
    requirement,
    subStatements,
    focusId,
    locked,
}: {
    requirement: ElementWrapper;
    subStatements: { id: string; text: string }[];
    /** Scope the draft to this one control (see DraftPanel). */
    focusId?: string;
    locked?: boolean;
}) => {
    const job = useSyncExternalStore(
        subscribeDraftJob,
        getDraftJob,
        getServerDraftJob,
    );
    const [hasEvidence, setHasEvidence] = useState(false);
    const [weightsReady, setWeightsReady] = useState(false);
    const [supported, setSupported] = useState(true);
    const requirementId = requirement.element_identifier;

    useEffect(() => {
        if (FREE_TIER) {
            return;
        }
        let cancelled = false;
        const refreshEvidence = async () => {
            const links = await IDB.evidenceRequirements.getAll(
                IDBKeyRange.only(requirementId),
                "requirement_id",
            );
            if (!cancelled) {
                setHasEvidence(links.length > 0);
            }
        };
        refreshEvidence();
        window.addEventListener(TABLE_CHANGED_EVENT, refreshEvidence);
        return () => {
            cancelled = true;
            window.removeEventListener(TABLE_CHANGED_EVENT, refreshEvidence);
        };
    }, [requirementId]);

    useEffect(() => {
        if (FREE_TIER) {
            return;
        }
        let cancelled = false;
        (async () => {
            // The selection falls back to the default model when this
            // device cannot run it; only a device with no usable model
            // disables the feature.
            const model = resolveUsableModel(
                getSelectedModelId(),
                await getDeviceCapabilities(),
            );
            if (!model) {
                if (!cancelled) {
                    setSupported(false);
                    setWeightsReady(false);
                }
                return;
            }
            // Weights are build-time assets; their presence cannot change
            // while the page is open, so one probe is enough.
            const ready = await weightsAvailable(model);
            if (!cancelled) {
                setSupported(true);
                setWeightsReady(ready);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (FREE_TIER || locked || !isAiEnabled()) {
        return null;
    }

    // This button owns the job when it targets the same requirement and
    // focus; any other job blocks starting a second one (one slot).
    const owns =
        !!job &&
        job.requirement.element_identifier === requirementId &&
        job.focusId === focusId;
    const busyElsewhere = isDraftJobActive() && !owns;
    const disabled = !hasEvidence || !supported || busyElsewhere;
    const title = !supported
        ? "No usable model on this device — open AI Assistant in the menu"
        : busyElsewhere
          ? `A draft is already generating for ${job?.requirement.element_identifier} — finish or close it first`
          : !hasEvidence
            ? "Attach evidence to this requirement first"
            : "Draft a narrative from the attached evidence";

    const onClick = () => {
        if (!weightsReady) {
            openAiSettings();
        } else if (owns) {
            restoreDraftJob();
        } else {
            startDraftJob({ requirement, subStatements, focusId });
        }
    };

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            title={title}
            onClick={onClick}
            data-tour="draft-evidence"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="h-4"
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
            Draft from evidence
            <span className="rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-semibold uppercase text-amber-700">
                Beta
            </span>
        </Button>
    );
};
