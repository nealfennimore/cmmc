"use client";
import { IDB } from "@/app/db";
import { useActionState } from "react";
import { confirm } from "./confirm";
import { menuItemClasses } from "./ui";

export const ClearDB = () => {
    const action = async (prevState, formData: FormData) => {
        return await new Promise(async (resolve) => {
            try {
                const confirmed = await confirm({
                    title: "Reset database",
                    message:
                        "This clears all locally stored requirements and evidence. This cannot be undone.",
                    confirmLabel: "Reset database",
                    variant: "destructive",
                });
                if (!confirmed) {
                    return;
                }

                await IDB.securityRequirements.clear();
                await IDB.requirements.clear();
                await IDB.evidence.clear();
                await IDB.examineEvidence.clear();

                resolve(null);
            } finally {
                window.location.reload();
            }
        });
    };

    const [_, formAction, isPending] = useActionState(action, null);
    return (
        <form action={formAction}>
            <button
                type={"submit"}
                className={menuItemClasses()}
                disabled={isPending}
                tabIndex={-1}
            >
                <span>Reset Database</span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="h-4"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 3h6M3 6h18m-2 0-.701 10.52c-.105 1.578-.158 2.367-.499 2.965a3 3 0 0 1-1.298 1.215c-.62.3-1.41.3-2.993.3h-3.018c-1.582 0-2.373 0-2.993-.3A3 3 0 0 1 6.2 19.485c-.34-.598-.394-1.387-.499-2.966L5 6"
                    />
                </svg>
            </button>
        </form>
    );
};
