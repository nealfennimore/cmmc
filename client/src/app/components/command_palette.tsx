"use client";
import { Revision, toPath } from "@/app/context/revision";
import {
    GlobalSearchValue,
    globalSearchHref,
    globalSearchOptions,
} from "@/app/search/global_options";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "./confirm";
import { IconSearch } from "./icons";
import { Option } from "./search_dropdown";

// The palette mounts in the root layout, outside any RevisionProvider, so
// the revision comes from the URL; non-revision pages default to Rev 3.
const revisionFor = (pathname: string | null): Revision =>
    pathname?.startsWith("/r2") ? Revision.V2 : Revision.V3;

// The palette lives in the root layout while its triggers (e.g. the navbar
// search button) render in unrelated trees, so opening goes through a window
// event rather than threaded context.
const OPEN_EVENT = "open-command-palette";

/** Open the global search palette (same as pressing Ctrl/Cmd+K). */
export const openCommandPalette = (): void => {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
};

const PaletteDialog = ({
    revision,
    onNavigate,
    onClose,
}: {
    revision: Revision;
    onNavigate: (value: GlobalSearchValue) => void;
    onClose: () => void;
}) => {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Option[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    // Guards against a slow earlier search resolving after a newer one.
    const requestId = useRef(0);

    useEffect(() => {
        const current = ++requestId.current;
        if (!query.trim()) {
            setResults([]);
            return;
        }
        const timer = window.setTimeout(async () => {
            const options = await globalSearchOptions(revision, query);
            if (current === requestId.current) {
                setResults(options);
                setActiveIndex(0);
            }
        }, 150);
        return () => window.clearTimeout(timer);
    }, [query, revision]);

    return (
        <ModalShell
            ariaLabel="Search"
            onDismiss={onClose}
            initialFocusRef={inputRef}
            panelClassName="max-w-xl self-start mt-[12vh]"
        >
            {(finish) => (
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 border-b border-border px-4">
                        <span className="text-muted-foreground">
                            <IconSearch />
                        </span>
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setActiveIndex((i) =>
                                        Math.min(i + 1, results.length - 1),
                                    );
                                }
                                if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setActiveIndex((i) => Math.max(i - 1, 0));
                                }
                                if (e.key === "Enter" && results[activeIndex]) {
                                    e.preventDefault();
                                    const value = results[activeIndex].value;
                                    finish(() => onNavigate(value));
                                }
                            }}
                            placeholder="Search requirements and evidence…"
                            aria-label="Search requirements and evidence"
                            className="w-full bg-transparent py-4 pr-12 text-base text-foreground outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    {results.length > 0 ? (
                        <ul className="max-h-80 overflow-y-auto p-2">
                            {results.map((item, i) => (
                                <li key={item.label + i}>
                                    <button
                                        type="button"
                                        onMouseEnter={() => setActiveIndex(i)}
                                        onClick={() =>
                                            finish(() => onNavigate(item.value))
                                        }
                                        className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                                            i === activeIndex
                                                ? "bg-secondary"
                                                : ""
                                        }`}
                                    >
                                        {item.label}
                                        {item.sublabel && (
                                            <span className="block text-xs text-muted-foreground">
                                                {item.sublabel}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                            {query.trim()
                                ? "No matches."
                                : `Search ${revision} requirements and your evidence.`}
                        </p>
                    )}
                </div>
            )}
        </ModalShell>
    );
};

/**
 * Global Ctrl+K / Cmd+K search palette, available on every page. Requirement
 * hits open the requirement page; evidence hits open the evidence table
 * pre-filtered to the query.
 */
export const CommandPalette = () => {
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const revision = revisionFor(pathname);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setOpen((current) => !current);
            }
        };
        const onOpen = () => setOpen(true);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener(OPEN_EVENT, onOpen);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener(OPEN_EVENT, onOpen);
        };
    }, []);

    if (!open) {
        return null;
    }
    // Remounted on each open, so the query and results always start fresh.
    return (
        <PaletteDialog
            revision={revision}
            onClose={() => setOpen(false)}
            onNavigate={(value) => {
                router.push(globalSearchHref(toPath(revision), value));
                setOpen(false);
            }}
        />
    );
};
