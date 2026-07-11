import { ReactNode } from "react";
import { Card } from "./ui";

export interface Stat {
    label: string;
    value: ReactNode;
}

export const Stats = ({ stats }: { stats: Stat[] }) => (
    <div className="mb-4 flex flex-wrap gap-4">
        {stats.map((stat) => (
            <Card
                key={stat.label}
                className="flex min-w-28 flex-col px-4 py-3"
            >
                <span className="text-2xl font-semibold tracking-tight">
                    {stat.value}
                </span>
                <span className="text-xs text-muted-foreground">
                    {stat.label}
                </span>
            </Card>
        ))}
    </div>
);
