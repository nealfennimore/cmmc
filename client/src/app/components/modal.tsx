import { useEffect } from "react";
import { Button } from "./ui";

interface InfoModalProps {
    open: boolean;
    title: string;
    children: React.ReactNode;
    onClose: () => void;
}

export function InfoModal({ open, title, children, onClose }: InfoModalProps) {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        if (open) {
            document.addEventListener("keydown", onKeyDown);
            document.body.style.overflow = "hidden";
        }

        return () => {
            document.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = "";
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <h2 className="text-lg font-semibold tracking-tight">
                        {title}
                    </h2>

                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        ✕
                    </button>
                </div>

                <div className="px-6 py-5 text-sm leading-6 text-muted-foreground">
                    {children}
                </div>

                <div className="flex justify-end border-t border-border px-6 py-4">
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
}
