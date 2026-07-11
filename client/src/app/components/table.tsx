"use client";
import { debounce } from "./security_requirements/utils";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "./ui";

interface TableRowProps {
    values: string[];
    columns: React.ReactNode[];
    classNames?: (null | string)[];
    onClick?: (null | ((index: number) => void)) | (() => void);
}

export enum Order {
    ASC = "asc",
    DESC = "desc",
    NONE = "none",
}

export interface ColumnOrder {
    order: Order;
    priority?: number;
}

const OrderPath = {
    ["asc"]: Order.DESC,
    ["desc"]: Order.NONE,
    ["none"]: Order.ASC,
};

type Sorter = (a: any, b: any) => number;
type Filter = (search: string) => (value: string) => boolean;
type PotentialSorter = null | Sorter;
type PotentialFilter = null | Filter;
type PotentialOrder = null | Order;
type OrderPriorty = number | null;
// A column search is a single term (text input) or a set of terms (multi
// select), matched with OR semantics within the column.
type PotentialSearch = null | string | string[];

interface SortableProps {
    text: string;
    setRows: React.Dispatch<React.SetStateAction<TableRowProps[]>>;
    rows: TableRowProps[];
    colIndex: number;
    sorter: Sorter;
    orders: PotentialOrder[];
    setOrders: React.Dispatch<React.SetStateAction<PotentialOrder[]>>;
    ascending?: number;
}

const Sortable = ({ text, colIndex, orders, setOrders }: SortableProps) => {
    const toggleOrder = () => {
        const nextOrder = OrderPath[orders[colIndex] ?? Order.NONE];
        const nextOrders = [...orders];
        nextOrders[colIndex] = nextOrder;
        setOrders(nextOrders);
    };

    const order = orders?.[colIndex] ?? Order.NONE;
    const top = order === Order.ASC ? "" : "stroke-slate-300";
    const bottom = order === Order.DESC ? "" : "stroke-slate-300";

    return (
        <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground transition-colors hover:text-foreground"
            onClick={toggleOrder}
        >
            {text}
            <input type="hidden" name={`orders_${colIndex}`} value={order} />
            <svg
                className="w-4 h-4 ms-1"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                fill="none"
                viewBox="0 0 24 24"
            >
                <path
                    className={top}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="m12 5 4 4-4-4-4 4"
                />
                <path
                    className={bottom}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="m12 19 4-4-4 4-4-4"
                />
            </svg>
        </button>
    );
};

const Searchable = ({ text, colIndex }: { text: string; colIndex: number }) => {
    return (
        <Input
            name={`searches_${colIndex}`}
            type="text"
            className="h-7 w-full min-w-24 px-2 text-xs font-normal normal-case"
            placeholder={`Filter ${text}`}
        />
    );
};

// Enum-like columns filter via a dropdown of checkboxes over the distinct
// values present in the rows (array values, e.g. requirement ids, are
// flattened). Multiple checked values combine with OR. Each checked box
// submits a `searches_N` form entry; processRows collects the repeats into
// an array, so the panel must stay mounted (hidden) while closed.
const SearchableSelect = ({
    colIndex,
    rows,
}: {
    colIndex: number;
    rows: TableRowProps[];
}) => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    const options = useMemo(() => {
        const unique = new Set<string>();
        for (const row of rows) {
            const value = row.values[colIndex];
            if (Array.isArray(value)) {
                for (const entry of value) {
                    unique.add(entry);
                }
            } else if (value) {
                unique.add(value);
            }
        }
        return [...unique].sort(defaultSort);
    }, [rows, colIndex]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (e: MouseEvent) => {
            if (!containerRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    // The table recomputes on bubbling change events. Clicking a checkbox
    // bubbles natively, but the programmatic "Clear" does not, so emit a
    // synthetic change once the checkboxes have re-rendered.
    useEffect(() => {
        containerRef.current?.dispatchEvent(
            new Event("change", { bubbles: true }),
        );
    }, [selected]);

    const toggle = (option: string) =>
        setSelected((current) =>
            current.includes(option)
                ? current.filter((entry) => entry !== option)
                : [...current, option],
        );

    const label =
        selected.length === 0
            ? "All"
            : selected.length === 1
              ? selected[0]
              : `${selected.length} selected`;

    return (
        <div
            ref={containerRef}
            className="relative font-normal normal-case"
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((showing) => !showing)}
                className="flex h-7 w-full min-w-24 items-center justify-between gap-1 rounded-md border border-input bg-surface px-2 text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span className="truncate">{label}</span>
                <svg
                    className="h-3 w-3 shrink-0"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m6 9 6 6 6-6"
                    />
                </svg>
            </button>
            <div
                className={`absolute left-0 top-full z-20 mt-1 flex max-h-64 w-max min-w-full flex-col overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md ${
                    open ? "" : "hidden"
                }`}
            >
                {selected.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setSelected([])}
                        className="rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary"
                    >
                        Clear selection
                    </button>
                )}
                {options.map((option) => (
                    <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-secondary"
                    >
                        <input
                            type="checkbox"
                            name={`searches_${colIndex}`}
                            value={option}
                            checked={selected.includes(option)}
                            onChange={() => toggle(option)}
                            className="h-3.5 w-3.5 accent-primary"
                        />
                        {option}
                    </label>
                ))}
            </div>
        </div>
    );
};

const IconFunnel = () => (
    <svg
        className="h-3.5 w-3.5"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 5h16l-6 7v5.5L10 20v-8L4 5Z"
        />
    </svg>
);

interface TableHeaderProps {
    text: string;
    className?: string;
    setRows: React.Dispatch<React.SetStateAction<TableRowProps[]>>;
    initialRows: TableRowProps[];
    rows: TableRowProps[];
    colIndex: number;
    sorter?: PotentialSorter;
    filter?: PotentialFilter;
    filters?: PotentialFilter[];
    searches: PotentialSearch[];
    setSearches: React.Dispatch<React.SetStateAction<PotentialSearch[]>>;
    orders: PotentialOrder[];
    setOrders: React.Dispatch<React.SetStateAction<PotentialOrder[]>>;
}

function TableHeader({
    text,
    className,
    sorter,
    filter,
    filters,
    orders,
    ...restProps
}: TableHeaderProps) {
    return (
        <th
            scope="col"
            className={`px-6 py-3 ${className ?? ""}`}
            data-searchable="true"
        >
            <div className="flex items-center">
                {sorter && (
                    <Sortable
                        text={text ?? ""}
                        sorter={sorter}
                        orders={orders}
                        {...restProps}
                    />
                )}
                {!sorter && (
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                        {text}
                    </span>
                )}
            </div>
        </th>
    );
}

function TableRow({ columns, classNames, onClick }: TableRowProps) {
    return (
        <tr className="border-b border-border bg-card transition-colors hover:bg-secondary">
            {columns.map((Element, idx) => (
                <td
                    key={idx}
                    scope="row"
                    className={`px-6 py-4 whitespace-pre-line ${
                        classNames?.[idx] ?? ""
                    }`}
                    onClick={onClick}
                >
                    {Element}
                </td>
            ))}
        </tr>
    );
}

interface THProps {
    text: string;
    className?: string;
    /** "select" renders the column's filter as a dropdown of the distinct
     *  values present in the rows instead of a free-text input. */
    filterKind?: "text" | "select";
}

interface Props {
    tableHeaders: THProps[];

    tableBody: TableRowProps[];

    sorters?: PotentialSorter[];
    filters?: PotentialFilter[];
    initialOrders?: PotentialOrder[];

    formRef: React.RefObject<HTMLFormElement> | null;
}

export const defaultSort = (a: any, b: any) => {
    if (!isNaN(Number(a)) && !isNaN(Number(b))) {
        return a.localeCompare(b, undefined, {
            numeric: true,
        });
    }
    return a.localeCompare(b);
};

export const defaultFilter = (search: string) => (value: string) =>
    value.toLocaleLowerCase().includes(search.toLocaleLowerCase());

type Priority = number;

const processRows = ({
    formRef,
    initialRows,
    orders,
    searches,
    sorters,
    filters,
    priorities,
}: {
    formRef: React.RefObject<HTMLFormElement> | null;
    initialRows: TableRowProps[];
    orders: PotentialOrder[];
    searches: PotentialSearch[];
    sorters?: PotentialSorter[];
    filters?: PotentialFilter[];
    priorities?: OrderPriorty[];
}) => {
    const next = {
        orders: [...orders],
        searches: [...searches],
    };

    if (formRef?.current) {
        const formData = new FormData(formRef.current);
        for (const [key, value] of formData.entries()) {
            const [name, index] = key.split("_");
            if (name !== "orders" && name !== "searches") {
                continue;
            }
            const idx = parseInt(index);
            if (name === "orders") {
                next.orders[idx] = value as Order;
                continue;
            }
            // Multi-select filters submit one entry per checked value;
            // collect repeats into an array (matched with OR below).
            const existing = next.searches[idx];
            next.searches[idx] = existing
                ? [
                      ...(Array.isArray(existing) ? existing : [existing]),
                      value as string,
                  ]
                : (value as string);
        }
    }

    // A row passes a column when any of the column's search terms match (OR
    // within a column); columns combine with AND.
    const matches = (
        filter: Filter,
        search: string | string[],
        value: string,
    ) =>
        Array.isArray(search)
            ? search.some((term) => filter(term)(value))
            : filter(search)(value);

    let nextRows = [...initialRows];
    for (const search of next.searches) {
        if (search && filters?.length) {
            nextRows = nextRows.filter((row) => {
                return filters.every((filter, index) => {
                    const columnSearch = next.searches[index];
                    return filter && columnSearch?.length
                        ? matches(filter, columnSearch, row.values[index])
                        : true;
                });
            });
        }
    }

    for (const [idx, order] of next.orders.entries()) {
        const sorter = sorters?.[idx];
        if (order && order !== Order.NONE && sorter) {
            nextRows.sort((a, b) => {
                return order === Order.DESC
                    ? sorter(b.values[idx], a.values[idx])
                    : sorter(a.values[idx], b.values[idx]);
            });
        }
    }

    return nextRows;
};

export function Table({
    tableHeaders,
    tableBody: initialRows,
    sorters,
    filters,
    initialOrders,
    formRef,
}: Props) {
    const [rows, setRows] = useState(
        processRows({
            formRef,
            initialRows,
            orders: initialOrders || [],
            searches: [],
            sorters,
            filters,
        }),
    );
    const [searches, setSearches] = useState(
        new Array(filters?.length).fill(null) as PotentialSearch[],
    );
    const [orders, setOrders] = useState(
        initialOrders ||
            (new Array(filters?.length).fill(Order.NONE) as PotentialOrder[]),
    );
    const [showFilters, setShowFilters] = useState(false);
    const [activeFilters, setActiveFilters] = useState(0);

    const handleChange = () => {
        const nextRows = processRows({
            formRef,
            initialRows,
            orders,
            searches,
            sorters,
            filters,
        });
        setRows(nextRows);

        // Count columns with an active filter so the toggle can flag them
        // even while the filter row is collapsed. Multi-select columns can
        // submit several entries; a Set keeps it one per column.
        if (formRef?.current) {
            const formData = new FormData(formRef.current);
            const active = new Set<string>();
            for (const [key, value] of formData.entries()) {
                if (key.startsWith("searches_") && value) {
                    active.add(key);
                }
            }
            setActiveFilters(active.size);
        }
    };

    const debouncedHandleChange = debounce(handleChange, 500);

    useEffect(handleChange, [
        orders,
        initialRows,
        filters,
        formRef,
        searches,
        sorters,
    ]);

    const hasFilters = !!filters?.some(Boolean);

    return (
        <>
            {hasFilters && (
                <div className="flex items-center justify-end border-b border-border bg-secondary px-4 py-2">
                    <button
                        type="button"
                        aria-expanded={showFilters}
                        onClick={() => setShowFilters((showing) => !showing)}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium uppercase text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <IconFunnel />
                        Filters
                        {activeFilters > 0 && (
                            <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
                                {activeFilters}
                            </span>
                        )}
                    </button>
                </div>
            )}
            <table
                className="w-full text-left text-sm text-foreground rtl:text-right"
                onChange={debouncedHandleChange}
            >
                <thead className="border-b border-border bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                        {tableHeaders.map((headerProps, index) => (
                            <TableHeader
                                key={index}
                                {...headerProps}
                                colIndex={index}
                                initialRows={initialRows}
                                rows={rows}
                                setRows={setRows}
                                sorter={sorters?.[index]}
                                filter={filters?.[index]}
                                filters={filters}
                                searches={searches}
                                setSearches={setSearches}
                                orders={orders}
                                setOrders={setOrders}
                            />
                        ))}
                    </tr>
                    {/* The filter row stays mounted while collapsed so typed
                        filters persist (and keep applying); the toggle's count
                        badge flags them while hidden. */}
                    {hasFilters && (
                        <tr className={showFilters ? "" : "hidden"}>
                            {tableHeaders.map((headerProps, index) => (
                                <th
                                    key={index}
                                    className={`px-6 pb-3 ${headerProps.className ?? ""}`}
                                >
                                    {filters?.[index] &&
                                        (headerProps.filterKind ===
                                        "select" ? (
                                            <SearchableSelect
                                                colIndex={index}
                                                rows={initialRows}
                                            />
                                        ) : (
                                            <Searchable
                                                text={headerProps.text}
                                                colIndex={index}
                                            />
                                        ))}
                                </th>
                            ))}
                        </tr>
                    )}
                </thead>
                <tbody>
                    {rows.map((rowProps, index) => (
                        <TableRow key={index} {...rowProps} />
                    ))}
                </tbody>
            </table>
        </>
    );
}
