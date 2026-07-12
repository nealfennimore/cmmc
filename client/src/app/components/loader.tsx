"use client";

// Full-page busy overlay for long-running import/export tasks. Same
// module-level store + portal-host pattern as confirm.tsx, but context-free on
// the caller side (plain functions, no hook), so it also works from code that
// runs outside the app's providers — e.g. the license gate's data export.

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface ActiveLoader {
    id: number;
    message: string;
}

let activeLoaders: ActiveLoader[] = [];
const listeners = new Set<() => void>();
let nextLoaderId = 1;
const EMPTY: ActiveLoader[] = [];

const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const getSnapshot = () => activeLoaders;
const getServerSnapshot = () => EMPTY;

// The overlay stays up at least this long, so a fast task reads as a
// deliberate step instead of an unidentifiable flash.
const MIN_VISIBLE_MS = 2000;

/**
 * Show the full-page loader. Returns a hide callback that resolves once the
 * overlay is actually gone (removal waits out the minimum visible time).
 * Prefer {@link withLoader} unless the overlay must outlive the task (e.g. up
 * through a page reload).
 */
export function showLoader(message: string): () => Promise<void> {
    const id = nextLoaderId++;
    const shownAt = performance.now();
    activeLoaders = [...activeLoaders, { id, message }];
    emit();
    return () =>
        new Promise((resolve) => {
            const remove = () => {
                activeLoaders = activeLoaders.filter(
                    (loader) => loader.id !== id,
                );
                emit();
                resolve();
            };
            const remaining = MIN_VISIBLE_MS - (performance.now() - shownAt);
            if (remaining > 0) {
                window.setTimeout(remove, remaining);
            } else {
                remove();
            }
        });
}

// The overlay is committed by React on the store update, but a task that
// starts with heavy synchronous work (JSON.parse on a 100MB export) would
// block the paint — so yield past one frame before starting the task.
const nextPaint = () =>
    new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

/**
 * Run `fn` behind the full-page loader, hiding it when the task settles.
 * Resolves only after the overlay is gone, so anything the caller opens next
 * (e.g. a confirm dialog) never sits underneath it while the minimum visible
 * time runs out.
 */
export async function withLoader<T>(
    message: string,
    fn: () => Promise<T> | T,
): Promise<T> {
    const hide = showLoader(message);
    try {
        await nextPaint();
        return await fn();
    } finally {
        await hide();
    }
}

/**
 * Renders the loader overlay through a portal into <body>. Mounted once in the
 * root layout so every surface is covered, including the license gate, which
 * renders while the app tree (and its providers) is unmounted. Above the
 * gate's z-[100] so the overlay blocks interaction there too.
 */
export function LoaderHost() {
    const loaders = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );

    if (typeof document === "undefined" || loaders.length === 0) {
        return null;
    }

    // Tasks can stack (e.g. read stage then import stage); show the newest.
    const { message } = loaders[loaders.length - 1];

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
            <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-lg border border-border bg-card px-6 py-8 text-card-foreground shadow-lg">
                <span
                    aria-hidden="true"
                    className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary"
                />
                <p className="text-center text-sm font-medium">{message}</p>
                <p className="text-center text-xs text-muted-foreground">
                    This can take a moment — keep the app open.
                </p>
            </div>
        </div>,
        document.body,
    );
}
