"use client";
// "AI Assistant" settings: model choice, engine status, and the master
// switch. Weights are bundled at build time — there is nothing to download
// or delete here; a build without bundled weights shows the feature as
// unavailable. The menu item only dispatches an open event; the modal itself
// is mounted at the app level (layout.tsx) because the nav dropdown unmounts
// its children on any outside click (same pattern as the License modal).

import { useEffect, useMemo, useState } from "react";
import { FREE_TIER } from "@/app/utils/tier";
import {
    DEFAULT_MODEL_ID,
    LlmModel,
    MODELS,
    getModel,
    isPinned,
    resolveUsableModel,
    usableDevice,
} from "@/app/llm/config";
import {
    DeviceCapabilities,
    getDeviceCapabilities,
} from "@/app/llm/capabilities";
import {
    LlmStatus,
    subscribeLlmStatus,
    unloadModel,
    weightsAvailable,
} from "@/app/llm/engine";
import {
    getSelectedModelId,
    isAiEnabled,
    isAutoSummarizeEnabled,
    setAiEnabled,
    setAutoSummarizeEnabled,
    setSelectedModelId,
} from "@/app/llm/settings";
import {
    cancelSummarySync,
    ensureSummarySynced,
    startSummarySync,
} from "@/app/llm/summary_sync";
import {
    EmbedderState,
    probeEmbedder,
    subscribeEmbedderState,
    unloadEmbedder,
} from "@/app/llm/embedder";
import {
    cancelEmbedSync,
    ensureEmbedSynced,
    startEmbedSync,
} from "@/app/llm/embed_sync";
import { confirm } from "../confirm";
import { InfoModal } from "../modal";
import { closeDraftJob } from "./draft_job";
import {
    isTauri,
    modelDelete,
    modelDownload,
    modelImport,
    modelStoreCancel,
    modelStorePoll,
    modelStoreStatus,
} from "@/app/utils/tauri";
import { Badge, Button, Label, Select, menuItemClasses } from "../ui";

export const AI_SETTINGS_OPEN_EVENT = "ai-settings-open";

/** One status line for the retrieval embedder
 *  (docs/embedding-retrieval-plan.md). Without it, retrieval is BM25 only. */
const SemanticSearchStatus = ({ enabled }: { enabled: boolean }) => {
    const [state, setState] = useState<EmbedderState | undefined>();
    useEffect(() => {
        let cancelled = false;
        const refresh = () =>
            void probeEmbedder().then((next) => {
                if (!cancelled) {
                    setState(next);
                }
            });
        refresh();
        const unsubscribe = subscribeEmbedderState(refresh);
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [enabled]);
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Semantic search</span>
            {state === undefined ? (
                <Badge variant="neutral">Detecting…</Badge>
            ) : state === "off" ? (
                <Badge variant="neutral">Off</Badge>
            ) : state === "unavailable" ? (
                <Badge variant="warning">Not available in this build</Badge>
            ) : state === "failed" ? (
                <Badge variant="warning">Failed to load</Badge>
            ) : (
                <Badge variant="success">On</Badge>
            )}
        </div>
    );
};

export const openAiSettings = (): void => {
    window.dispatchEvent(new CustomEvent(AI_SETTINGS_OPEN_EVENT));
};

const formatBytes = (bytes: number): string =>
    bytes >= 1e9
        ? `${(bytes / 1e9).toFixed(1)} GB`
        : `${Math.round(bytes / 1e6)} MB`;

export const AiMenuItem = () => {
    // The free web tier has no AI feature at all (see ai/model.ts gating).
    if (FREE_TIER) {
        return null;
    }
    return (
        <button
            type="button"
            className={menuItemClasses()}
            onClick={openAiSettings}
            tabIndex={-1}
        >
            <span className="flex items-center gap-2">
                AI Assistant
                <span className="rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-semibold uppercase text-amber-700">
                    Beta
                </span>
            </span>
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
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
                />
            </svg>
        </button>
    );
};

/** Weight state for the selected model in this build. */
type WeightState = "checking" | "bundled" | "missing";

export const AiSettingsModal = () => {
    const [open, setOpen] = useState(false);
    const [capabilities, setCapabilities] = useState<DeviceCapabilities>();
    const [enabled, setEnabled] = useState(true);
    const [autoSummarize, setAutoSummarize] = useState(false);
    const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
    const [weights, setWeights] = useState<WeightState>("checking");
    /** True when the weights came from the app-data store (user import)
     *  rather than the bundle — drives the Remove row. */
    const [imported, setImported] = useState(false);
    const [importing, setImporting] = useState(false);
    const [downloading, setDownloading] = useState(false);
    /** Bytes landed across all of the model's files (multi-file ONNX). */
    const [downloadedBytes, setDownloadedBytes] = useState(0);
    const [importError, setImportError] = useState<string | null>(null);
    const [status, setStatus] = useState<LlmStatus>({ phase: "idle" });

    const model = useMemo(() => getModel(modelId) ?? MODELS[0], [modelId]);

    useEffect(() => {
        const onOpen = () => {
            setEnabled(isAiEnabled());
            setAutoSummarize(isAutoSummarizeEnabled());
            setModelId(getSelectedModelId());
            setOpen(true);
        };
        window.addEventListener(AI_SETTINGS_OPEN_EVENT, onOpen);
        return () => window.removeEventListener(AI_SETTINGS_OPEN_EVENT, onOpen);
    }, []);

    useEffect(() => subscribeLlmStatus(setStatus), []);

    useEffect(() => {
        if (!open || !model) {
            return;
        }
        let cancelled = false;
        setWeights("checking");
        (async () => {
            const detected = await getDeviceCapabilities();
            if (cancelled) {
                return;
            }
            setCapabilities(detected);
            const bundled = await weightsAvailable(model);
            const stored = await modelStoreStatus(model.repo);
            if (!cancelled) {
                setWeights(bundled ? "bundled" : "missing");
                setImported(!!stored);
                setImportError(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, model]);

    if (FREE_TIER || !model) {
        return null;
    }

    const loadedHere =
        status.modelId === model.id &&
        (status.phase === "ready" || status.phase === "generating");

    // Installers bundle no model; every model arrives through the
    // verified store. Download works for any pinned model on a desktop
    // build (multi-file ONNX downloads file by file); the offline import
    // picker stays single-file, so it is offered for GGUF models only.
    const importable =
        model.format === "gguf" &&
        !!capabilities?.native &&
        model.files.length > 0;
    const downloadable = isTauri() && model.files.length > 0;

    const runImport = async () => {
        const file = model.files[0];
        if (!file) {
            return;
        }
        setImportError(null);
        setImporting(true);
        try {
            const result = await modelImport({
                repo: model.repo,
                path: file.path,
                sha256: file.sha256,
                size: file.size,
            });
            if (result) {
                setImported(true);
                setWeights(
                    (await weightsAvailable(model)) ? "bundled" : "missing",
                );
            }
        } catch (error) {
            setImportError(
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            setImporting(false);
        }
    };

    const removeImport = async () => {
        await modelDelete(model.repo);
        setImported(false);
        setWeights((await weightsAvailable(model)) ? "bundled" : "missing");
    };

    const runDownload = async () => {
        const proceed = await confirm({
            title: "Download model",
            message: `Download ${model.label} (${formatBytes(model.totalBytes)}) from huggingface.co? This is the only time the app downloads anything, and every file is verified against the pinned checksum before use.`,
            confirmLabel: "Download",
        });
        if (!proceed) {
            return;
        }
        setImportError(null);
        setDownloading(true);
        setDownloadedBytes(0);
        // Overall progress = completed files + the in-flight transfer.
        let landed = 0;
        const poll = window.setInterval(async () => {
            const progress = await modelStorePoll();
            if (progress?.active) {
                setDownloadedBytes(landed + progress.bytes);
            }
        }, 500);
        try {
            for (const file of model.files) {
                await modelDownload({
                    repo: model.repo,
                    path: file.path,
                    url: file.url,
                    sha256: file.sha256,
                    size: file.size,
                });
                landed += file.size;
                setDownloadedBytes(landed);
            }
            setImported(true);
            setWeights(
                (await weightsAvailable(model)) ? "bundled" : "missing",
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            // A user cancel is not an error state.
            if (!message.includes("cancelled")) {
                setImportError(message);
            }
        } finally {
            window.clearInterval(poll);
            setDownloading(false);
        }
    };

    return (
        <InfoModal
            open={open}
            title="AI Assistant"
            onClose={() => setOpen(false)}
        >
            <div className="flex flex-col gap-4">
                <p>
                    Drafts control narratives from your attached evidence and
                    reviews it against the assessment objectives. Every model
                    runs entirely on this device — your evidence and notes are
                    never uploaded anywhere. The model downloads only when you
                    request it here, and is verified against a pinned
                    checksum before use.
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    These features are in beta. A small on-device model can
                    produce wrong or inconsistent output — treat everything it
                    writes as a starting point and verify it against your
                    evidence before relying on it.
                </p>

                <label className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                        Enable AI features
                    </span>
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                            const on = event.target.checked;
                            setEnabled(on);
                            setAiEnabled(on);
                            if (!on) {
                                // Disabling stops everything and frees the
                                // models' memory. Order matters: the jobs
                                // must abort while their workers are alive
                                // — an abort sent after disposal would
                                // spawn a fresh worker.
                                cancelSummarySync();
                                cancelEmbedSync();
                                closeDraftJob();
                                unloadModel();
                                unloadEmbedder();
                            } else {
                                startEmbedSync();
                                void ensureEmbedSynced();
                            }
                        }}
                    />
                </label>

                <div className="flex flex-col gap-1">
                    <label className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                            Summarize evidence in the background
                        </span>
                        <input
                            type="checkbox"
                            checked={autoSummarize}
                            disabled={!enabled || weights === "missing"}
                            onChange={(event) => {
                                const on = event.target.checked;
                                setAutoSummarize(on);
                                setAutoSummarizeEnabled(on);
                                if (on) {
                                    startSummarySync();
                                    void ensureSummarySynced();
                                } else {
                                    cancelSummarySync();
                                }
                            }}
                        />
                    </label>
                    <p className="text-xs text-muted-foreground">
                        Pre-summarizes evidence files whenever they change, so
                        drafts start almost immediately. Loads the model and
                        uses GPU and battery in the background.
                    </p>
                </div>

                <SemanticSearchStatus enabled={enabled} />

                <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Engine</span>
                    {capabilities === undefined ? (
                        <Badge variant="neutral">Detecting…</Badge>
                    ) : capabilities.device === "webgpu" ? (
                        <Badge variant="success">WebGPU</Badge>
                    ) : capabilities.native ? (
                        <Badge variant="success">Native</Badge>
                    ) : (
                        <Badge variant="warning">
                            No WebGPU — no model runs here
                        </Badge>
                    )}
                </div>

                <div className="flex flex-col gap-1">
                    <Label htmlFor="ai-model">Model</Label>
                    <Select
                        id="ai-model"
                        value={modelId}
                        onChange={(event) => {
                            setModelId(event.target.value);
                            setSelectedModelId(event.target.value);
                            // A model switch keeps stored summaries (their
                            // fingerprint has no model). The pass only picks
                            // up files that have no summary yet; a no-op when
                            // the auto toggle is off.
                            void ensureSummarySynced();
                        }}
                    >
                        {MODELS.map((candidate: LlmModel) => {
                            const unusable =
                                capabilities !== undefined &&
                                usableDevice(candidate, capabilities) === null;
                            return (
                                <option
                                    key={candidate.id}
                                    value={candidate.id}
                                    disabled={!isPinned(candidate) || unusable}
                                >
                                    {candidate.label}
                                    {!isPinned(candidate)
                                        ? " (not available in this build)"
                                        : !unusable
                                          ? ""
                                          : candidate.minDevice === "native"
                                            ? " (desktop app only)"
                                            : capabilities?.device === "webgpu"
                                              ? " (needs more GPU memory)"
                                              : " (needs WebGPU)"}
                                </option>
                            );
                        })}
                    </Select>
                    {(() => {
                        const effective = capabilities
                            ? resolveUsableModel(modelId, capabilities)
                            : undefined;
                        return effective && effective.id !== modelId ? (
                            <p className="text-xs text-muted-foreground">
                                This device cannot run the selected model, so
                                the {effective.label} runs instead.
                            </p>
                        ) : null;
                    })()}
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                    {model.totalBytes >= 2e9 && (
                        <p className="text-xs text-muted-foreground">
                            Large model: needs roughly 4 GB of GPU memory. If
                            generation fails with an out-of-memory error,
                            switch back to the default model.
                        </p>
                    )}
                    {weights === "checking" && <p>Checking model weights…</p>}
                    {weights === "bundled" && (
                        <div className="flex items-center justify-between gap-4">
                            <span>
                                {imported
                                    ? "Added and verified"
                                    : "Bundled with this app"}{" "}
                                ({formatBytes(model.totalBytes)}).
                            </span>
                            <div className="flex items-center gap-2">
                                {imported && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={loadedHere}
                                        onClick={removeImport}
                                    >
                                        Remove
                                    </Button>
                                )}
                                {loadedHere && (
                                    <Badge variant="success">Loaded</Badge>
                                )}
                            </div>
                        </div>
                    )}
                    {weights === "missing" &&
                        (downloadable ? (
                            <div className="flex flex-col gap-2">
                                <p>
                                    The installer keeps its size down by not
                                    including this model (
                                    {formatBytes(model.totalBytes)}). Download
                                    it once
                                    {importable
                                        ? ", or import the exact pinned file offline"
                                        : ""}{" "}
                                    — the app verifies every byte against the
                                    pinned manifest before use.
                                </p>
                                {downloading ? (
                                    <div className="flex items-center gap-2">
                                        <span aria-live="polite">
                                            Downloading…{" "}
                                            {formatBytes(downloadedBytes)} of{" "}
                                            {formatBytes(model.totalBytes)}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void modelStoreCancel()
                                            }
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={importing}
                                            onClick={runDownload}
                                        >
                                            Download (
                                            {formatBytes(model.totalBytes)})
                                        </Button>
                                        {importable && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={importing}
                                                onClick={runImport}
                                            >
                                                {importing
                                                    ? "Verifying…"
                                                    : "Import model file…"}
                                            </Button>
                                        )}
                                    </div>
                                )}
                                {importError && (
                                    <p role="alert" className="text-red-600">
                                        {importError}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p>
                                This build does not include this model&apos;s
                                weights, so it is unavailable here — see{" "}
                                <code>docs/local-ai.md</code>.
                            </p>
                        ))}
                    {status.phase === "error" &&
                        status.modelId === model.id && (
                            <p role="alert" className="text-red-600">
                                {status.error}
                            </p>
                        )}
                </div>

                <p className="border-t border-border pt-3 text-xs">
                    {model.licenseNotice}.{" "}
                    <a
                        href={model.licenseUrl}
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                    >
                        {model.license}
                    </a>
                    . AI output is a draft — review it before use.
                </p>
            </div>
        </InfoModal>
    );
};
