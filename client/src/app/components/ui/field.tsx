import {
    InputHTMLAttributes,
    LabelHTMLAttributes,
    SelectHTMLAttributes,
    TextareaHTMLAttributes,
    forwardRef,
} from "react";
import { cn } from "./cn";

const control =
    "flex w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
    <input
        ref={ref}
        type={type}
        className={cn(control, "h-9 py-1", className)}
        {...props}
    />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
    HTMLTextAreaElement,
    TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
    <textarea
        ref={ref}
        className={cn(control, "min-h-32 py-2", className)}
        {...props}
    />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
    HTMLSelectElement,
    SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(control, "h-9 py-1", className)}
        {...props}
    />
));
Select.displayName = "Select";

export const Label = forwardRef<
    HTMLLabelElement,
    LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
    <label
        ref={ref}
        className={cn(
            "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
            className,
        )}
        {...props}
    />
));
Label.displayName = "Label";
