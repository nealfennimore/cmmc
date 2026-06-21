"use client";
import { isTauri, openExternal } from "@/app/utils/tauri";
import { useEffect } from "react";

/**
 * In the desktop shell, route clicks on absolute http(s) links to the system
 * browser instead of navigating the app's webview. No-op in the browser build.
 */
export const ExternalLinkHandler = () => {
    useEffect(() => {
        if (!isTauri()) {
            return;
        }
        const onClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0) {
                return;
            }
            const anchor = (event.target as HTMLElement)?.closest?.("a");
            const href = anchor?.getAttribute("href");
            if (!href || !/^https?:\/\//i.test(href)) {
                return;
            }
            event.preventDefault();
            openExternal(href);
        };
        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, []);

    return null;
};
