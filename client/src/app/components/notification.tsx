import { ReactNode } from "react";

export const Notification = ({
    children,
    ...props
}: {
    children: ReactNode;
}) => (
    <div
        {...props}
        className="z-0 w-full max-w-md rounded-lg border border-blue-200 bg-accent p-4 text-sm normal-case text-accent-foreground shadow-md"
    >
        {children}
    </div>
);
