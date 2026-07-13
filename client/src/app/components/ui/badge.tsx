import { HTMLAttributes } from "react";
import { cn } from "./cn";

export type BadgeVariant =
    | "info"
    | "neutral"
    | "success"
    | "warning"
    | "danger"
    | "tagged";

const base =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium";

const variants: Record<BadgeVariant, string> = {
    info: "bg-accent text-accent-foreground border-blue-200",
    neutral: "bg-secondary text-secondary-foreground border-border",
    success: "bg-green-50 text-green-700 border-green-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    // Evidence tagged as a shared Examine document.
    tagged: "bg-orange-50 text-orange-700 border-orange-200",
};

export function badgeClasses(
    variant: BadgeVariant = "neutral",
    className?: string,
): string {
    return cn(base, variants[variant], className);
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: BadgeVariant;
}

export const Badge = ({
    className,
    variant = "neutral",
    ...props
}: BadgeProps) => (
    <span className={badgeClasses(variant, className)} {...props} />
);
