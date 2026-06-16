import { cn } from "./cn";

/**
 * Shared styling for items inside the navigation dropdown menu (export, import,
 * report generators, etc.). Every menu action renders an icon on the right and
 * a label on the left.
 */
export function menuItemClasses(className?: string): string {
    return cn(
        "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none disabled:opacity-50",
        className,
    );
}
