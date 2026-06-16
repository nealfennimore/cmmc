import { ReactNode } from "react";

interface Row {
    title: ReactNode;
    value: ReactNode;
    visible?: boolean;
    className?: string;
}

interface Props {
    rows: Row[];
}

export const DataTable = ({ rows }: Props) => {
    return (
        <dl className="flex flex-row">
            {rows.reduce((acc, row, idx) => {
                if (row.visible !== undefined && row.visible) {
                    acc.push(
                        <div className={row.className || ""} key={idx}>
                            <dt className="border-b-2 border-r-2 border-border bg-secondary px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                                {row.title}
                            </dt>
                            <dd className="border-b-2 border-border bg-card px-4 py-2 text-xs text-foreground">
                                {row.value}
                            </dd>
                        </div>
                    );
                }
                return acc;
            }, [] as ReactNode[])}
        </dl>
    );
};
