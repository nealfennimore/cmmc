"use client";
// Persisted user preferences for the local summarizer. localStorage, not
// IndexedDB: these are per-device UI prefs, never exported with compliance
// data, and needed synchronously before the DB opens.

import { DEFAULT_MODEL_ID, getModel } from "./config";

const ENABLED_KEY = "llm.enabled";
const MODEL_KEY = "llm.model";
const AUTO_SUMMARIZE_KEY = "llm.autoSummarize";
const SUMMARY_CONTEXT_KEY = "llm.summaryContext";

/** Fired on window when the summary-context setting changes: the review
 *  fingerprint depends on it, so the review panel recomputes staleness. */
export const SUMMARY_CONTEXT_CHANGED_EVENT = "llm-summary-context-changed";

const storage = (): Storage | undefined =>
    typeof window !== "undefined" ? window.localStorage : undefined;

/** Master switch for the AI feature; on by default (the feature still does
 *  nothing unless the build bundled model weights). */
export const isAiEnabled = (): boolean =>
    storage()?.getItem(ENABLED_KEY) !== "false";

export const setAiEnabled = (enabled: boolean): void =>
    storage()?.setItem(ENABLED_KEY, String(enabled));

/** The stored selection, or the default when the stored id is not in the
 *  manifest (model ids change between releases). Without this check, the
 *  settings modal shows MODELS[0] while resolveUsableModel falls through
 *  to a different model, so the two disagree about which weights exist. */
export const getSelectedModelId = (): string => {
    const stored = storage()?.getItem(MODEL_KEY);
    return stored && getModel(stored) ? stored : DEFAULT_MODEL_ID;
};

export const setSelectedModelId = (id: string): void =>
    storage()?.setItem(MODEL_KEY, id);

/** Background evidence summarization; off by default — it loads the model
 *  and runs the GPU without a user action, so it is opt-in. */
export const isAutoSummarizeEnabled = (): boolean =>
    storage()?.getItem(AUTO_SUMMARIZE_KEY) === "true";

export const setAutoSummarizeEnabled = (enabled: boolean): void =>
    storage()?.setItem(AUTO_SUMMARIZE_KEY, String(enabled));

/** Document summaries (overviews) as context in draft and review prompts;
 *  on by default, the behavior before the toggle existed. Off: a draft
 *  skips summarization, a review ignores stored summaries, and the
 *  excerpts get the whole evidence budget. A comparison switch for the
 *  question whether the prompts still need summaries now that the embedder
 *  picks the excerpts (docs/embedding-retrieval-plan.md). */
export const isSummaryContextEnabled = (): boolean =>
    storage()?.getItem(SUMMARY_CONTEXT_KEY) !== "false";

export const setSummaryContextEnabled = (enabled: boolean): void => {
    storage()?.setItem(SUMMARY_CONTEXT_KEY, String(enabled));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SUMMARY_CONTEXT_CHANGED_EVENT));
    }
};
