import { HTMLAttributes, createElement } from "react";
import { cn } from "./cn";

export type HeadingLevel = 1 | 2 | 3 | 4;

const levels: Record<HeadingLevel, string> = {
    1: "text-4xl font-bold tracking-tight",
    2: "text-3xl font-bold tracking-tight",
    3: "text-2xl font-semibold tracking-tight",
    4: "text-xl font-semibold",
};

export function headingClasses(level: HeadingLevel, className?: string): string {
    return cn(levels[level], className);
}

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
    level: HeadingLevel;
    as?: keyof JSX.IntrinsicElements;
}

/**
 * Consistent page/section headings. `level` controls visual size/weight; pass
 * `as` to override the rendered tag for semantics independent of size.
 */
export const Heading = ({
    level,
    as,
    className,
    ...props
}: HeadingProps) =>
    createElement(as ?? `h${level}`, {
        className: headingClasses(level, className),
        ...props,
    });
