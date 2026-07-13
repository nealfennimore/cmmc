import { ReactNode } from "react";
import { Card, cn } from "./ui";

export interface Stat {
    label: string;
    value: ReactNode;
    /** Small glyph rendered before the label (e.g. the file-type icon). */
    icon?: ReactNode;
    /** When set, the card renders as a button (e.g. to toggle a filter). */
    onClick?: () => void;
    /** Highlights the card as the active selection. */
    active?: boolean;
}

const cardClasses = "flex min-w-28 flex-col px-4 py-3 text-left";

const StatContent = ({ stat }: { stat: Stat }) => (
    <>
        <span className="text-2xl font-semibold tracking-tight">
            {stat.value}
        </span>
        <span className="flex items-center text-xs text-muted-foreground">
            {stat.icon}
            {stat.label}
        </span>
    </>
);

export const Stats = ({ stats }: { stats: Stat[] }) => (
    <div className="mb-4 flex flex-wrap gap-4">
        {stats.map((stat) =>
            stat.onClick ? (
                <button
                    key={stat.label}
                    type="button"
                    onClick={stat.onClick}
                    aria-pressed={stat.active}
                    className={cn(
                        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
                        cardClasses,
                        "transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        stat.active && "border-primary ring-1 ring-primary",
                    )}
                >
                    <StatContent stat={stat} />
                </button>
            ) : (
                <Card key={stat.label} className={cardClasses}>
                    <StatContent stat={stat} />
                </Card>
            ),
        )}
    </div>
);
