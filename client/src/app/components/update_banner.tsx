"use client";
// Non-blocking "update available" notice. Rendered as a row inside the
// fixed-bottom banner stack owned by LicenseGate. On macOS/Windows it installs
// in place; on Linux it links to the download page (notify-only).

import { useUpdate } from "@/app/context/update";
import { openExternal } from "@/app/utils/tauri";

export function UpdateBanner() {
    const { result, phase, error, dismissed, install, restart, dismiss } =
        useUpdate();

    if (!result?.available || dismissed) {
        return null;
    }

    const version = result.version ?? "";

    return (
        <div className="relative flex w-full items-center justify-center gap-3 border-t border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
            <span>
                {phase === "installed"
                    ? `Version ${version} installed.`
                    : `Version ${version} is available.`}
            </span>
            {error && <span className="text-red-400">{error}</span>}
            {phase === "installed" ? (
                <button
                    type="button"
                    onClick={restart}
                    className="font-medium text-white underline underline-offset-2 hover:no-underline"
                >
                    Restart now
                </button>
            ) : result.platformSupportsInstall ? (
                <button
                    type="button"
                    onClick={install}
                    disabled={phase === "downloading"}
                    className="font-medium text-white underline underline-offset-2 hover:no-underline disabled:opacity-50"
                >
                    {phase === "downloading"
                        ? "Downloading…"
                        : "Install and restart"}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() =>
                        result.downloadUrl && openExternal(result.downloadUrl)
                    }
                    className="font-medium text-white underline underline-offset-2 hover:no-underline"
                >
                    Download
                </button>
            )}
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss update notice"
                className="absolute right-3 rounded-md px-2 py-0.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
                ✕
            </button>
        </div>
    );
}
