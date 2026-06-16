"use client";
import { toPath, useRevisionContext } from "@/app/context/revision";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClearDB } from "./clear_db";
import { ExportEvidence, ViewEvidence } from "./export_evidence";
import { ExportEvidenceMap } from "./export_evidence_map";
import { Export, Import } from "./export_import";
import { Markdown } from "./markdown";
import { POAM } from "./poam";
import { Tree } from "./tree";

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
            className="bg-gray-900 fixed w-full z-40 top-0 start-0 border-b border-gray-600"
        >
            <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
                <a
                    href={path}
                    className="flex items-center space-x-3 rtl:space-x-reverse block"
                    tabIndex={100}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 839.1 396.999"
                        className="fill-white h-[50px]"
                    >
                        <path
                            d="M270.5 695.644c-53.493-26.146-95.49-60.511-121.666-99.558-17.383-25.928-27.332-53.806-30.798-86.297-1.59-14.897-1.394-146.918.221-149.126.917-1.254 4.772-2.258 14.25-3.713 44.347-6.803 87.532-20.794 137.504-44.548 8.565-4.07 16.28-7.402 17.144-7.402.865 0 7.046 2.694 13.737 5.987 47.222 23.24 89.07 37.243 134.397 44.97 9.234 1.575 17.447 3.409 18.25 4.076 2.233 1.852 2.164 144.294-.076 159.224-9.14 60.903-44.076 110.528-106.463 151.23-23.02 15.019-54.55 31.514-60.237 31.512-1.977 0-8.388-2.505-16.263-6.355M292 629c4.906-1.387 58.914-29.591 68.773-35.915 9.111-5.845 13.613-10.443 16.407-16.758 1.785-4.037 1.875-7.064 1.605-54.55L378.5 471.5l-2.401-3.367c-2.815-3.946-9.091-7.08-14.243-7.111l-3.644-.022-.467-19.25c-.508-20.889-1.474-26.205-6.784-37.332-6.132-12.847-18.54-25.623-31.033-31.954-11.22-5.687-17.396-6.966-33.428-6.929-13.611.032-15.753.287-23.13 2.756-15.899 5.32-32.036 18.92-39.648 33.414-6.099 11.613-7.737 19.922-8.045 40.795l-.266 18-5.15.634c-6.242.768-11.08 3.598-13.761 8.047-1.93 3.202-2 5.092-2 53.819 0 48.172.09 50.684 1.965 54.5 4.515 9.194 16.393 17.06 57.035 37.765C284.383 631 284.622 631.085 292 629m-19.96-60.766-2.181-1.767 3.914-15.563 3.915-15.563-3.963-3.327c-9.575-8.038-10.108-20.091-1.265-28.609 4.714-4.54 11.675-6.949 16.928-5.856 9.464 1.968 16.703 10.237 16.752 19.136.036 6.609-1.525 10.103-6.643 14.868l-4.367 4.068 3.915 15.44 3.915 15.439-2.09 1.75c-3.1 2.594-25.622 2.581-28.83-.016M241.015 445.76c.022-22.497 2.87-32.064 12.555-42.171 7.783-8.123 16.08-12.224 27.43-13.557 18.471-2.17 37.892 7.905 45.928 23.825 4.355 8.627 4.983 12.23 5.259 30.143l.254 16.5-45.72.26-45.721.26Zm293.387 118.82c-17.13-3.91-28.21-15.05-32.902-33.08-3.681-14.146-3.688-56.27-.011-70.5 6.006-23.244 24.559-36.46 48.644-34.653 18.146 1.361 31.025 11.313 36.79 28.425 1.142 3.39 2.077 8.44 2.077 11.22v5.054l-12.25-.52-12.25-.52-.667-4.5c-1.489-10.052-8.31-15.99-18.377-16-9.579-.01-15.035 4.978-18.11 16.55-2.503 9.423-2.514 50.565-.015 59.887 3.052 11.388 8.795 16.451 18.669 16.459 9.494.007 15.818-4.906 18.151-14.1l.965-3.802 11.692.143 11.692.143.317 3.152c.434 4.323-3.313 15.108-7.238 20.83-9.06 13.208-29.124 19.933-47.177 15.812m368.098.38c-19.68-4.033-30.89-16.314-35.108-38.46-2.096-11.007-2.357-45.716-.434-58 3.229-20.64 12.823-33.9 28.767-39.755 8.45-3.103 25.434-3.023 33.557.158 14.868 5.823 25.677 20.89 26.081 36.357l.137 5.24-12-.219c-10.62-.194-12.037-.424-12.326-2-1.783-9.743-5.627-15.143-12.706-17.846-3.095-1.182-5.715-1.491-8.657-1.02C896.281 451.577 892 462.775 892 496c0 16.335 1.362 29.533 3.601 34.902 3.765 9.027 12.613 13.446 22.28 11.127 6.07-1.457 9.802-5.185 12.16-12.15l1.77-5.228 11.84.254c6.513.14 12.028.44 12.256.669.788.788-2.092 11.948-4.425 17.144-2.965 6.606-9.983 14.148-16.428 17.656-8.683 4.726-22.428 6.663-32.554 4.587m-299.753-1.678c-.226-.43-.34-30.932-.252-67.782l.16-67 14.212-.278 14.212-.277 1.398 3.345c.768 1.84 7.063 19.065 13.988 38.277 6.925 19.213 12.84 35.608 13.144 36.433s6.896-16.4 14.646-38.276l14.09-39.775 14.578.275 14.577.276.201 67.243.201 67.243-2.201.55c-1.21.303-6.476.418-11.701.257l-9.5-.293-.26-43.75c-.144-24.062-.65-43.75-1.126-43.75s-1.159 1.238-1.52 2.75c-.36 1.513-5.711 15.575-11.892 31.25l-11.237 28.5H651.62l-2.176-5.5c-1.196-3.025-6.849-17.388-12.56-31.918L626.5 474.663l-.5 44.419-.5 44.418-11.171.282c-6.144.155-11.356-.07-11.582-.5m134.725-.5c-.27-.705-.373-31.207-.231-67.782l.259-66.5h29l13.246 37.5c7.285 20.625 13.247 38.063 13.25 38.75.016 4.647 3.17-2.91 13.985-33.5 6.756-19.112 13.105-36.675 14.108-39.028l1.823-4.277 14.186.277 14.187.278.013 66.794c.01 42.884-.342 67.15-.979 67.787-.569.569-5.438.87-11.406.706L828.5 563.5l-.5-44c-.39-34.36-.753-43.452-1.655-41.5-1.028 2.224-13.439 34.327-20.794 53.787l-2.754 7.288-8.494-.288-8.493-.287-12.155-31.315L761.5 475.87l-.5 43.815-.5 43.815-11.269.283c-8.458.212-11.39-.037-11.759-1"
                            transform="translate(-116.94 -305)"
                        />
                    </svg>
                </a>
                <div className="flex items-center md:order-2 space-x-3 md:space-x-0 rtl:space-x-reverse">
                    <button
                        key="tree-open"
                        className="px-5 me-2  text-sm font-medium focus:z-20 focus:ring-4 focus:ring-gray-100 focus:ring-gray-700 text-gray-500 border-gray-600 border-r hover:text-gray-600 flex items-center"
                        onClick={() => {
                            setTreeIsOpen(!isTreeOpen);
                        }}
                    >
                        <span className="mr-1 hidden md:block">Overview</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            xmlSpace="preserve"
                            viewBox="0 0 135.467 135.467"
                            className="w-5 fill-gray-500 "
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
                                className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-transparent px-3 py-3 text-sm font-semibold text-gray-500 shadow-sm"
                                id="menu-button"
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
                                className="absolute top-10 right-0 z-100 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none divide-y divide-gray-100"
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
                                    <a
                                        href="https://github.com/nealfennimore/cmmc"
                                        className="block px-4 py-2 text-sm text-gray-700 flex flex-row"
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
    ];
};
