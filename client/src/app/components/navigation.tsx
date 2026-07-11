"use client";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClearDB } from "./clear_db";
import { ExportEvidence, ViewEvidence } from "./export_evidence";
import { ExportEvidenceMap } from "./export_evidence_map";
import { Export, Import } from "./export_import";
import { LicenseMenuItem } from "./license_settings";
import { Markdown } from "./markdown";
import { POAM } from "./poam";
import { Tour, TourMenuItem } from "./tour";
import { Tree } from "./tree";
import { menuItemClasses } from "./ui";

export const Navigation = () => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const [isOpen, setIsOpen] = useState(false);
    const [isTreeOpen, setTreeIsOpen] = useState(false);
    const menuRef = useRef<HTMLElement>(null);
    const onKeyDown = useMemo(
        () => (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        },
        [],
    );
    const onClick = useMemo(
        () => (event: MouseEvent) => {
            if (menuRef.current?.contains(event.target as Node)) {
                return;
            }
            setIsOpen(false);
        },
        [],
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("click", onClick);
        } else {
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("click", onClick);
        }
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("click", onClick);
        };
    }, [isOpen]);

    return [
        <nav
            key="nav"
            className="fixed top-0 start-0 z-40 w-full border-b border-slate-800 bg-slate-900"
        >
            <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between p-4 sm:px-6 lg:px-8">
                <a
                    href={path}
                    className="flex items-center space-x-3 rtl:space-x-reverse block"
                    tabIndex={100}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        aria-label="getCMMC mark"
                        viewBox="0 0 80 80"
                        className="fill-white h-[40px]"
                    >
                        <path
                            fill="#122a47"
                            stroke="#3fc7e8"
                            strokeWidth="3"
                            d="m40 8 28 16v32L40 72 12 56V24z"
                        />
                        <path
                            fill="none"
                            stroke="#f2f5fa"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="4.5"
                            d="m27 39 10 9 17-19"
                        />
                    </svg>
                    <span className="font-[family-name:var(--font-dm-serif)] text-2xl text-white">
                        GetCMMC
                    </span>
                </a>
                <div className="flex items-center md:order-2 space-x-3 md:space-x-0 rtl:space-x-reverse">
                    <button
                        key="tree-open"
                        data-tour="overview"
                        className="me-2 inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                            setTreeIsOpen(!isTreeOpen);
                        }}
                    >
                        <span className="hidden md:block">Overview</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            xmlSpace="preserve"
                            viewBox="0 0 135.467 135.467"
                            className="w-5 fill-current"
                        >
                            <path
                                d="M66.041 79.726v33.867h33.867V79.726H82.975Zm13.494 40.746v67.477h6.88v-.01l27.053.067 27.054.067.07 6.813.07 6.813h33.859v-33.866h-33.867v13.494h-54.24v-40.749l27.054.068 27.054.067.07 6.68.07 6.681h33.859v-33.602h-33.867v13.494h-54.24v-13.494h-3.44z"
                                transform="translate(-52.652 -72.76)"
                            />
                        </svg>
                    </button>
                    <div className="relative inline-block text-left">
                        <div>
                            <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-md p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                id="menu-button"
                                data-tour="menu"
                                aria-expanded="true"
                                aria-haspopup="true"
                                onClick={() => setIsOpen(!isOpen)}
                            >
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 30 30"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    data-slot="icon"
                                    className="translate-y-[2px]"
                                >
                                    <rect width="30" height="3" />
                                    <rect y="9" width="30" height="3" />
                                    <rect y="18" width="30" height="3" />
                                </svg>
                            </button>
                        </div>
                        {isOpen && (
                            <div
                                className="absolute right-0 top-12 z-50 mt-2 w-56 origin-top-right divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-lg focus:outline-none"
                                role="menu"
                                aria-orientation="vertical"
                                aria-labelledby="menu-button"
                                tabIndex={-1}
                                onSubmit={() => setIsOpen(false)}
                                onKeyUp={() => setIsOpen(false)}
                                ref={menuRef}
                            >
                                <div className="py-1" role="none">
                                    <Markdown />
                                    <POAM />
                                </div>
                                <div className="py-1" role="none">
                                    <Export />
                                    <Import />
                                </div>
                                <div className="py-1" role="none">
                                    <ViewEvidence path={path} />
                                    <ExportEvidence />
                                    <ExportEvidenceMap />
                                </div>
                                <div className="py-1" role="none">
                                    <ClearDB />
                                </div>
                                <div className="py-1" role="none">
                                    <LicenseMenuItem />
                                    <TourMenuItem />
                                    <a
                                        href="https://github.com/nealfennimore/cmmc"
                                        className={menuItemClasses(
                                            "justify-start gap-2",
                                        )}
                                        tabIndex={100}
                                    >
                                        <svg
                                            className="w-5 h-5"
                                            aria-hidden="true"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="currentColor"
                                            viewBox="0 0 20 20"
                                        >
                                            <path
                                                fillRule="evenodd"
                                                d="M10 .333A9.911 9.911 0 0 0 6.866 19.65c.5.092.678-.215.678-.477 0-.237-.01-1.017-.014-1.845-2.757.6-3.338-1.169-3.338-1.169a2.627 2.627 0 0 0-1.1-1.451c-.9-.615.07-.6.07-.6a2.084 2.084 0 0 1 1.518 1.021 2.11 2.11 0 0 0 2.884.823c.044-.503.268-.973.63-1.325-2.2-.25-4.516-1.1-4.516-4.9A3.832 3.832 0 0 1 4.7 7.068a3.56 3.56 0 0 1 .095-2.623s.832-.266 2.726 1.016a9.409 9.409 0 0 1 4.962 0c1.89-1.282 2.717-1.016 2.717-1.016.366.83.402 1.768.1 2.623a3.827 3.827 0 0 1 1.02 2.659c0 3.807-2.319 4.644-4.525 4.889a2.366 2.366 0 0 1 .673 1.834c0 1.326-.012 2.394-.012 2.72 0 .263.18.572.681.475A9.911 9.911 0 0 0 10 .333Z"
                                                clipRule="evenodd"
                                            ></path>
                                        </svg>
                                    </a>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </nav>,
        <Tree key="tree" isOpen={isTreeOpen} setOpen={setTreeIsOpen} />,
        <Tour key="tour" />,
    ];
};
