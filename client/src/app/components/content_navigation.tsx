"use client";
import { ElementWrapper } from "@/api/entities/Framework";
import { toPath, useRevisionContext } from "@/app/context/revision";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { buttonClasses } from "./ui";

interface PageNavigationProps {
    previous?: ElementWrapper | undefined;
    next?: ElementWrapper | undefined;

    elementIdentity?: (
        element: ElementWrapper | undefined,
    ) => string | undefined;

    elementType?: string;
}

const defaultElementIdentity = (element: ElementWrapper | undefined) =>
    element?.requirement;

function inViewport(element: HTMLAnchorElement) {
    const clientRect = element.getBoundingClientRect();
    return (
        // 82 = navbar height
        clientRect.top >= 82 &&
        clientRect.left >= 0 &&
        clientRect.bottom <=
            (window.innerHeight || document.documentElement.clientHeight) &&
        clientRect.right <=
            (window.innerWidth || document.documentElement.clientWidth)
    );
}

export const ContentNavigation = ({
    previous,
    next,
    elementType = "requirement",
    elementIdentity = defaultElementIdentity,
}: PageNavigationProps) => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const previousRef = useRef<HTMLAnchorElement>(null);
    const nextRef = useRef<HTMLAnchorElement>(null);

    useEffect(() => {
        if (nextRef.current && inViewport(nextRef.current)) {
            nextRef.current.focus();
        } else if (previousRef.current && inViewport(previousRef.current)) {
            previousRef.current.focus();
        }
    }, [previousRef, nextRef]);

    const prevElement = elementIdentity(previous);
    const nextElement = elementIdentity(next);

    return (
        <aside className="mb-4 flex w-full flex-row flex-wrap gap-2">
            {previous && (
                <Link
                    href={`${path}/${elementType}/${prevElement}`}
                    className={buttonClasses({ variant: "outline" })}
                    tabIndex={10}
                    ref={previousRef}
                >
                    <svg
                        className="h-5 w-5 text-muted-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M15 19l-7-7 7-7"
                        ></path>
                    </svg>
                    <span className="truncate">
                        <span>{prevElement}</span>
                        {!!previous.title && (
                            <span className="hidden md:inline">
                                : {previous.title}
                            </span>
                        )}
                    </span>
                </Link>
            )}
            {next && (
                <Link
                    href={`${path}/${elementType}/${nextElement}`}
                    className={buttonClasses({ variant: "outline" })}
                    tabIndex={11}
                    ref={nextRef}
                >
                    <span className="truncate">
                        <span>{nextElement}</span>
                        {!!next.title && (
                            <span className="hidden md:inline">
                                : {next.title}
                            </span>
                        )}
                    </span>
                    <svg
                        className="h-5 w-5 text-muted-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </Link>
            )}
        </aside>
    );
};
