"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Positioning + show/hide state for hover cards that must escape a scroll
 * container (e.g. the evidence table's overflow-x-auto wrapper clips
 * absolutely-positioned children). The card renders through a portal at a
 * fixed viewport position captured from the trigger on hover; a short grace
 * timeout lets the pointer travel from the trigger into the card (keeping
 * its content selectable), and any outside scroll or resize closes the card
 * rather than letting it drift from its trigger.
 *
 * Wire `show(e.currentTarget)` / `scheduleHide` to the trigger's enter/leave
 * (and focus/blur), and `cancelHide` / `scheduleHide` to the card's. A card
 * with scrollable content should also attach `cardRef`, so its own scrolls
 * don't count as "outside".
 */
export const useHoverCard = () => {
    const [position, setPosition] = useState<{
        top: number;
        left: number;
    } | null>(null);
    const hideTimer = useRef<number | undefined>(undefined);
    const cardRef = useRef<HTMLElement | null>(null);

    const show = (trigger: HTMLElement | null) => {
        window.clearTimeout(hideTimer.current);
        const rect = trigger?.getBoundingClientRect();
        if (rect) {
            setPosition({ top: rect.top - 4, left: rect.left });
        }
    };
    const cancelHide = () => window.clearTimeout(hideTimer.current);
    const scheduleHide = () => {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setPosition(null), 150);
    };
    const hide = () => {
        window.clearTimeout(hideTimer.current);
        setPosition(null);
    };

    useEffect(() => {
        if (!position) {
            return;
        }
        const close = () => setPosition(null);
        const onScroll = (e: Event) => {
            if (!cardRef.current?.contains(e.target as Node)) {
                close();
            }
        };
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", close);
        };
    }, [position]);

    return { position, show, cancelHide, scheduleHide, hide, cardRef };
};
