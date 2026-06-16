/**
 * Tiny className joiner. Filters out falsy values and joins with a space.
 * Keep primitive base classes free of conflicts with the layout/spacing
 * classes that call sites pass via `className`, since this does not de-dupe.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
    return classes.filter(Boolean).join(" ");
}
