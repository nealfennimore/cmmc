import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";

export type ButtonVariant =
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "destructive"
    | "success"
    | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:opacity-90",
    secondary:
        "bg-secondary text-secondary-foreground shadow-sm hover:bg-slate-200",
    outline:
        "border border-input bg-surface text-foreground shadow-sm hover:bg-secondary",
    ghost: "text-foreground hover:bg-secondary",
    destructive:
        "bg-destructive text-destructive-foreground shadow-sm hover:opacity-90",
    success: "bg-success text-success-foreground shadow-sm hover:opacity-90",
    link: "text-primary underline-offset-4 hover:underline",
};

const sizes: Record<ButtonSize, string> = {
    sm: "h-8 rounded px-3 text-xs",
    md: "h-9 px-4 py-2 text-sm",
    lg: "h-10 px-6 text-sm",
    icon: "h-9 w-9",
};

export interface ButtonClassesOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
}

/**
 * Returns the composed class string for a button. Use this for elements that
 * cannot be the <Button> component itself — e.g. Next.js <Link> rendered as a
 * button.
 */
export function buttonClasses({
    variant = "primary",
    size = "md",
    className,
}: ButtonClassesOptions = {}): string {
    return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "primary", size = "md", type, ...props }, ref) => (
        <button
            ref={ref}
            type={type ?? "button"}
            className={buttonClasses({ variant, size, className })}
            {...props}
        />
    ),
);
Button.displayName = "Button";
