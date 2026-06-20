"use client";
import { ElementWrapper } from "@/api/entities/Framework";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { Status, StatusState } from "../status";
import { Label, Select, Textarea } from "../ui";

export interface SecurityRequirementProps {
    securityRequirement: ElementWrapper;
    initialState: Record<string, string>;
    hasPartialValue: boolean;
    isPending: boolean;
    idx?: number;
}

export const SelectStatus = ({
    id,
    defaultValue,
    isPending,
    hasPartialValue,
}: {
    id: string;
    defaultValue: string;
    isPending: boolean;
    hasPartialValue: boolean;
}) => {
    const [hasChanged, setHasChanged] = useState(!!defaultValue);
    const inputRef = useRef<HTMLSelectElement>(null);
    const setToChanged = useMemo(
        () => () => !hasChanged && setHasChanged(true),
        [hasChanged],
    );
    const emitChange = useMemo(
        () => () => {
            if (inputRef?.current) {
                inputRef?.current?.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                setToChanged();
            }
        },
        [inputRef, setToChanged],
    );

    return (
        <div onBlur={emitChange} onClick={setToChanged} onKeyUp={setToChanged}>
            <Select
                // HACK: To get around react resetting select element back to default value
                // as it doesn't re-render properly otherwise
                key={`${id}-${isPending}`}
                id={id}
                name={id}
                ref={inputRef}
                disabled={isPending}
                defaultValue={defaultValue}
                tabIndex={20}
            >
                <option value={Status.NOT_IMPLEMENTED}>Not Implemented</option>
                <option value={Status.IMPLEMENTED}>Implemented</option>
                {hasPartialValue && (
                    <option value={Status.PARTIALLY_IMPLEMENTED}>
                        Partially Implemented
                    </option>
                )}
                <option value={Status.NOT_APPLICABLE}>Not Applicable</option>
                <option value={Status.NOT_STARTED}>Not Started</option>
            </Select>
            {/* 
                NOTE: Don't allow status to be stored until an actual change has occurred (first committed to as user by clicking on the select parent element)

                In cases where the status is not changed, we don't render the hidden input element to allow the status to be stored correctly
            */}
            {!hasChanged && (
                <input type="hidden" name={id} value={defaultValue} />
            )}
        </div>
    );
};

export const SecurityRequirementSelect = ({
    securityRequirement,
    initialState,
    hasPartialValue,
    isPending,
}: SecurityRequirementProps) => {
    const key = `${securityRequirement.subSubRequirement}.status`;
    return (
        <div className="flex flex-col md:mr-2 lg:mr-4" key={key}>
            <Label htmlFor={key} className="my-2">
                Status
            </Label>
            <SelectStatus
                id={key}
                isPending={isPending}
                defaultValue={initialState[key]}
                hasPartialValue={hasPartialValue}
            />
        </div>
    );
};

export const SecurityRequirementNote = ({
    securityRequirement,
    initialState,
    isPending,
}: SecurityRequirementProps) => {
    const key = `${securityRequirement.subSubRequirement}.description`;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const growAreaRef = useRef<HTMLDivElement>(null);
    const mdRef = useRef<HTMLDivElement>(null);
    const parentRef = useRef<HTMLDivElement>(null);
    const [showOutput, setShowOutput] = useState(true);
    const [currentState, setCurrentState] = useState(initialState[key]);

    const hideOutput = useMemo(
        () => () => {
            setShowOutput(false);
            textareaRef?.current?.focus();
        },
        [],
    );
    const syncOutput = useMemo(
        () => async () => {
            if (mdRef?.current && textareaRef?.current) {
                setShowOutput(true);
                mdRef.current.innerHTML = await marked(
                    textareaRef?.current?.value,
                );
            }
        },
        [],
    );

    const replicateGrowArea = () => {
        if (growAreaRef?.current && textareaRef?.current) {
            growAreaRef.current.dataset.replicatedValue =
                textareaRef?.current?.value;
        }
    };

    useEffect(() => {
        (async () => {
            if (showOutput && currentState !== initialState[key]) {
                setCurrentState(initialState[key]);
                await syncOutput();
                replicateGrowArea();
            }
        })();
    }, [currentState, initialState]);

    useEffect(() => {
        if (textareaRef?.current) {
            textareaRef.current.addEventListener("focus", hideOutput);
            textareaRef.current.addEventListener("blur", syncOutput);
        }

        if (parentRef.current) {
            parentRef.current.addEventListener("click", hideOutput);
        }

        return () => {
            if (textareaRef?.current) {
                textareaRef.current.removeEventListener("focus", hideOutput);
                textareaRef.current.removeEventListener("blur", syncOutput);
            }

            if (parentRef.current) {
                parentRef.current.removeEventListener("click", hideOutput);
            }
        };
    }, [textareaRef, mdRef]);

    return (
        <div
            className="flex min-w-0 grow flex-col w-full lg:w-10/12"
            ref={parentRef}
        >
            <Label htmlFor={key} className="my-2">
                Description
            </Label>
            <div className="relative grow-wrap" ref={growAreaRef}>
                <Textarea
                    ref={textareaRef}
                    tabIndex={20}
                    name={key}
                    id={key}
                    onInput={replicateGrowArea}
                    onFocus={replicateGrowArea}
                    className={`z-0 grow ${
                        showOutput && textareaRef?.current?.value
                            ? "absolute opacity-0"
                            : ""
                    }`}
                    disabled={isPending}
                    defaultValue={initialState[key]}
                ></Textarea>
                <div
                    ref={mdRef}
                    tabIndex={-1}
                    className={`md-output relative z-10 min-h-32 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm ${
                        showOutput && textareaRef?.current?.value
                            ? ""
                            : "hidden"
                    }`}
                ></div>
            </div>
        </div>
    );
};

export const SecurityRequirement = ({
    securityRequirement,
    initialState,
    hasPartialValue,
    isPending,
    idx,
}: SecurityRequirementProps) => {
    return (
        <li className="mb-6">
            <fieldset className="flex grow flex-col">
                <legend className="flex flex-row items-center text-left text-xl font-semibold tracking-tight">
                    <StatusState
                        status={
                            initialState[
                                `${securityRequirement.subSubRequirement}.status`
                            ] as Status
                        }
                    />
                    <h4 id={securityRequirement.subSubRequirement}>
                        {securityRequirement.subSubRequirement}
                    </h4>
                </legend>
                <p className="my-2 text-base leading-relaxed">
                    {securityRequirement.text}
                </p>
                <div className="flex flex-col md:flex-row">
                    <SecurityRequirementSelect
                        securityRequirement={securityRequirement}
                        initialState={initialState}
                        hasPartialValue={hasPartialValue}
                        isPending={isPending}
                        idx={idx}
                    />
                    <SecurityRequirementNote
                        securityRequirement={securityRequirement}
                        initialState={initialState}
                        isPending={isPending}
                    />
                </div>
            </fieldset>
        </li>
    );
};
