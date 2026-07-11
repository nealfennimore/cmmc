"use client";
import { IDB, IDBSecurityRequirement } from "@/app/db";
import { useRequirementValue } from "@/app/hooks/requirementValues";
import { useActionState, useMemo, useState } from "react";
import { Status } from "../status";
import { Form } from "./form";
import { SecurityRequirement } from "./form_elements";
import { debounce } from "./utils";

export const saveState = async (requirementId: string, formData: FormData) => {
    const records: Record<string, Record<string, FormDataEntryValue>> = {};
    for (const [_key, value] of formData.entries()) {
        // Extract the id from the key to the last period
        const idx = _key.lastIndexOf(".");
        const id = _key.substring(0, idx);
        const key = _key.substring(idx + 1);
        records[id] = { ...(records?.[id] || {}), [key]: value };
    }
    for (const [id, record] of Object.entries(records)) {
        await IDB.securityRequirements?.put({
            id,
            ...record,
        } as IDBSecurityRequirement);
    }

    const statuses: Status[] = [];
    await IDB.requirements?.put({
        id: requirementId,
        bySecurityRequirementId: Object.entries(records).reduce(
            (acc, [id, record]) => {
                acc[id] = record.status;
                statuses.push(record.status as Status);
                return acc;
            },
            {},
        ),
    });

    return statuses;
};

export const SecurityForm = ({
    requirement,
    initialState,
    setInitialState,
    groupings,
    isHydrating,
    setStatuses,
    prev,
    next,
    locked,
}) => {
    const { partial_value } = useRequirementValue(requirement.id);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);

    async function action(prevState, formData) {
        // Free-tier locked requirements are read-only; this guard covers both
        // explicit submits and the debounced auto-save below.
        if (locked) {
            return;
        }
        const nextStatuses = await saveState(requirement.id, formData);
        setStatuses(nextStatuses);
        setInitialState(Object.fromEntries(formData.entries()));
        setLastSaved(new Date());
    }

    const debouncedSave = useMemo(
        () =>
            debounce(async (event) => {
                if (!event.target?.form) {
                    return;
                }
                const formData = new FormData(event.target.form);
                await action(null, formData);
            }, 250),
        [requirement.id, setStatuses, setInitialState],
    );

    const [_, formAction, isPending] = useActionState(action, initialState);
    return (
        <Form
            debouncedSave={debouncedSave}
            formAction={formAction}
            isHydrating={isHydrating}
            lastSaved={lastSaved}
            next={next}
            prev={prev}
            requirement={requirement}
            locked={locked}
        >
            <>
                {Object.entries(groupings)?.map(([key, grouping], idx) => (
                    <ol key={key}>
                        {grouping.map((securityRequirement) => (
                            <SecurityRequirement
                                key={securityRequirement.element_identifier}
                                securityRequirement={securityRequirement}
                                hasPartialValue={partial_value > 0}
                                initialState={initialState}
                                isPending={isPending || isHydrating || locked}
                                idx={idx}
                            />
                        ))}
                    </ol>
                ))}
            </>
        </Form>
    );
};
