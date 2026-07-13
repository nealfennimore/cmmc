"use client";
import { ContentNavigation } from "../content_navigation";
import { Button } from "../ui";
import { Evidence } from "./evidence";

export const Form = ({
    children,
    debouncedSave,
    formAction,
    isHydrating,
    lastSaved,
    next,
    prev,
    requirement,
    locked,
}) => {
    return (
        <>
            <ContentNavigation previous={prev} next={next} />
            {!locked && (
                <div
                    className="sticky top-36 left-full flex flex-row-reverse items-center shrink-0 w-1/4 pb-4 z-20 -translate-y-full"
                    data-tour="save"
                >
                    <Button
                        type="submit"
                        variant="success"
                        className="w-24 shrink"
                        disabled={isHydrating}
                        tabIndex={30}
                        form={requirement.element_identifier}
                    >
                        Save
                    </Button>
                    {lastSaved && (
                        <span className="mr-2 hidden text-right text-sm text-muted-foreground md:block">
                            Last saved: {lastSaved?.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            )}
            <Evidence
                requirementId={requirement.element_identifier}
                locked={locked}
            />
            <form
                id={requirement.element_identifier}
                action={formAction}
                onChange={locked ? undefined : debouncedSave}
                className="basis-full"
                data-tour="requirement-form"
            >
                {children}
            </form>
        </>
    );
};
