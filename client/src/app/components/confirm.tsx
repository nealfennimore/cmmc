"use client";

import {
    Fragment,
    ReactNode,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Button, ButtonVariant } from "./ui";

export interface ConfirmOptions {
    /** Heading shown at the top of the dialog. */
    title?: string;
    /** Body copy explaining the consequence of the action. */
    message: ReactNode;
    /** Label for the primary (resolves `true`) button. */
    confirmLabel?: string;
    /** Label for the secondary (resolves `false`) button. */
    cancelLabel?: string;
    /** `destructive` tints the confirm button and shows a warning icon. */
    variant?: "default" | "destructive";
}

/** A single toggleable choice in a {@link confirmOptions} dialog. */
export interface ToggleOption {
    /** Key used in the returned result map. */
    key: string;
    /** Primary label for the toggle. */
    label: string;
    /** Optional secondary description shown under the label. */
    description?: string;
    /** Initial checked state (defaults to `false`). */
    default?: boolean;
}

export interface ConfirmOptionsDialog {
    title?: string;
    message?: ReactNode;
    options: ToggleOption[];
    confirmLabel?: string;
    cancelLabel?: string;
}

const TRANSITION_MS = 150;

function WarningIcon() {
    return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="h-5 w-5"
            >
                <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                />
            </svg>
        </span>
    );
}

/**
 * Shared modal chrome: backdrop, panel, enter/exit transitions, scroll lock,
 * Escape/backdrop dismissal and initial focus. `children` receives a `finish`
 * callback that plays the exit animation and then runs the given action, so
 * every dismissal path (buttons, Escape, backdrop) animates out consistently.
 */
function ModalShell({
    ariaLabel,
    onDismiss,
    initialFocusRef,
    children,
}: {
    ariaLabel: string;
    onDismiss: () => void;
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    children: (finish: (action: () => void) => void) => ReactNode;
}) {
    const [visible, setVisible] = useState(false);
    const settled = useRef(false);

    // Play the exit transition, then run the action exactly once.
    const finish = (action: () => void) => {
        if (settled.current) return;
        settled.current = true;
        setVisible(false);
        window.setTimeout(action, TRANSITION_MS);
    };

    useEffect(() => {
        // Enter on the next frame so the transition has an initial state.
        const raf = requestAnimationFrame(() => setVisible(true));
        initialFocusRef?.current?.focus();

        // Only Escape is handled globally; Enter naturally activates the
        // focused button, so a global Enter handler would fight it.
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") finish(onDismiss);
        };
        document.addEventListener("keydown", onKeyDown);
        document.body.style.overflow = "hidden";

        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = "";
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={() => finish(onDismiss)}
            className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm transition-opacity duration-150 ${
                visible ? "opacity-100" : "opacity-0"
            }`}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={`w-full max-w-md overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg transition-all duration-150 ${
                    visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
                }`}
            >
                {children(finish)}
            </div>
        </div>
    );
}

function ConfirmDialog({
    options,
    onResolve,
}: {
    options: ConfirmOptions;
    onResolve: (result: boolean) => void;
}) {
    const {
        title = "Are you sure?",
        message,
        confirmLabel = "Continue",
        cancelLabel = "Cancel",
        variant = "default",
    } = options;

    const confirmRef = useRef<HTMLButtonElement>(null);
    const confirmVariant: ButtonVariant =
        variant === "destructive" ? "destructive" : "primary";

    return (
        <ModalShell
            ariaLabel={title}
            onDismiss={() => onResolve(false)}
            initialFocusRef={confirmRef}
        >
            {(finish) => (
                <>
                    <div className="flex gap-4 px-6 py-5">
                        {variant === "destructive" && <WarningIcon />}
                        <div className="min-w-0 flex-1">
                            <h2 className="text-lg font-semibold tracking-tight">
                                {title}
                            </h2>
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                {message}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t border-border bg-secondary px-6 py-4">
                        <Button
                            variant="outline"
                            onClick={() => finish(() => onResolve(false))}
                        >
                            {cancelLabel}
                        </Button>
                        <Button
                            ref={confirmRef}
                            variant={confirmVariant}
                            onClick={() => finish(() => onResolve(true))}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </>
            )}
        </ModalShell>
    );
}

function OptionsDialog({
    dialog,
    onResolve,
}: {
    dialog: ConfirmOptionsDialog;
    onResolve: (result: Record<string, boolean> | null) => void;
}) {
    const {
        title = "Options",
        message,
        options,
        confirmLabel = "Continue",
        cancelLabel = "Cancel",
    } = dialog;

    const [values, setValues] = useState<Record<string, boolean>>(() =>
        options.reduce(
            (acc, option) => {
                acc[option.key] = option.default ?? false;
                return acc;
            },
            {} as Record<string, boolean>,
        ),
    );
    const confirmRef = useRef<HTMLButtonElement>(null);

    const toggle = (key: string) =>
        setValues((prev) => ({ ...prev, [key]: !prev[key] }));

    return (
        <ModalShell
            ariaLabel={title}
            onDismiss={() => onResolve(null)}
            initialFocusRef={confirmRef}
        >
            {(finish) => (
                <>
                    <div className="px-6 py-5">
                        <h2 className="text-lg font-semibold tracking-tight">
                            {title}
                        </h2>
                        {message && (
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                {message}
                            </div>
                        )}

                        <div className="mt-4 flex flex-col gap-2">
                            {options.map((option) => (
                                <label
                                    key={option.key}
                                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary"
                                >
                                    <input
                                        type="checkbox"
                                        checked={values[option.key]}
                                        onChange={() => toggle(option.key)}
                                        className="mt-0.5 h-4 w-4 accent-primary"
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-foreground">
                                            {option.label}
                                        </span>
                                        {option.description && (
                                            <span className="mt-0.5 block text-xs text-muted-foreground">
                                                {option.description}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t border-border bg-secondary px-6 py-4">
                        <Button
                            variant="outline"
                            onClick={() => finish(() => onResolve(null))}
                        >
                            {cancelLabel}
                        </Button>
                        <Button
                            ref={confirmRef}
                            onClick={() => finish(() => onResolve(values))}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </>
            )}
        </ModalShell>
    );
}

// A tiny module-level store of active dialogs. `confirm`/`confirmOptions` push
// requests onto it; the <ConfirmHost /> mounted in the app tree subscribes and
// renders them through a portal into <body>. Using a portal (instead of a
// separate detached React root) keeps the dialogs inside the app's React tree,
// so theming, context and event bubbling behave normally.
interface ActiveDialog {
    id: number;
    element: ReactNode;
}

let activeDialogs: ActiveDialog[] = [];
const listeners = new Set<() => void>();
let nextDialogId = 1;
const EMPTY: ActiveDialog[] = [];

const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const getSnapshot = () => activeDialogs;
const getServerSnapshot = () => EMPTY;

function pushDialog(makeElement: (dismiss: () => void) => ReactNode) {
    const id = nextDialogId++;
    const dismiss = () => {
        activeDialogs = activeDialogs.filter((dialog) => dialog.id !== id);
        emit();
    };
    activeDialogs = [...activeDialogs, { id, element: makeElement(dismiss) }];
    emit();
}

/**
 * Renders any active {@link confirm}/{@link confirmOptions} dialogs through a
 * portal into <body>. Mounted once by the toast provider, so every page that
 * shows the navigation gets it automatically.
 */
export function ConfirmHost() {
    const dialogs = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );

    if (typeof document === "undefined" || dialogs.length === 0) {
        return null;
    }

    return createPortal(
        <>
            {dialogs.map((dialog) => (
                <Fragment key={dialog.id}>{dialog.element}</Fragment>
            ))}
        </>,
        document.body,
    );
}

/**
 * Themed, promise-based replacement for `window.confirm`. Resolves `true` when
 * the user confirms, `false` when they cancel, dismiss, or press Escape.
 *
 *     if (await confirm({ title: "Delete?", message: "This cannot be undone." })) { ... }
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        pushDialog((dismiss) => (
            <ConfirmDialog
                options={options}
                onResolve={(result) => {
                    resolve(result);
                    dismiss();
                }}
            />
        ));
    });
}

/**
 * Show a single modal with a set of toggleable options. Resolves a map of
 * `{ [key]: boolean }` when confirmed, or `null` when cancelled/dismissed.
 *
 *     const choices = await confirmOptions({
 *         title: "Export",
 *         options: [{ key: "links", label: "Include links", default: true }],
 *     });
 *     if (!choices) return; // cancelled
 */
export function confirmOptions(
    dialog: ConfirmOptionsDialog,
): Promise<Record<string, boolean> | null> {
    return new Promise((resolve) => {
        pushDialog((dismiss) => (
            <OptionsDialog
                dialog={dialog}
                onResolve={(result) => {
                    resolve(result);
                    dismiss();
                }}
            />
        ));
    });
}
