import { HTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";

export const Card = forwardRef<
    HTMLDivElement,
    HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
            className,
        )}
        {...props}
    />
));
Card.displayName = "Card";
