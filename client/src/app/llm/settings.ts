"use client";
// Persisted user preferences for the local summarizer. localStorage, not
// IndexedDB: these are per-device UI prefs, never exported with compliance
// data, and needed synchronously before the DB opens.

import { DEFAULT_MODEL_ID, getModel } from "./config";

const ENABLED_KEY = "llm.enabled";
const MODEL_KEY = "llm.model";
const AUTO_SUMMARIZE_KEY = "llm.autoSummarize";

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
