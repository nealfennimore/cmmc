"use client";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { GlobalScore, useGlobalScore } from "@/app/hooks/score";
import { useGlobalStatus } from "@/app/hooks/status";
import { renderNumber } from "@/app/utils/number";
import { isFreeTier, unlockedIdsForRevision } from "@/app/utils/tier";
import { IconInfo } from "./icons";
import { Popover } from "./popover";
import { Status } from "./status";
import { UpgradeLink } from "./upgrade_cta";

interface Props {
    familyId?: string;
    requirementId?: string;
}

// Free tier: the 110-point SPRS scale is meaningless over the Level 1 subset
// (and L1 self-assessment doesn't use it), so show plain progress instead.
const LevelOneProgress = () => {
    const revision = useRevisionContext();
    const globalStatus = useGlobalStatus();
    const unlockedIds = unlockedIdsForRevision(revision);
    const implemented = unlockedIds.filter(
        (id) =>
            globalStatus?.[id.slice(0, 5)]?.requirementStatus(id) ===
            Status.IMPLEMENTED,
    ).length;

    return (
        <div data-tour="sprs-score">
            <span className="mr-1 text-sm text-muted-foreground">
                Level 1:
            </span>
            <span className="mr-2 text-sm font-medium text-foreground">
                {implemented} of {unlockedIds.length} implemented
            </span>
            <button popoverTarget="sprs-popover" aria-label="Scoring info">
                <IconInfo className="fill-muted-foreground" />
            </button>
            <Popover id="sprs-popover">
                <IconInfo />
                <p className="my-2">
                    Progress across the CMMC Level 1 practices available in the
                    free web app. SPRS scoring (out of 110) for all NIST
                    800-171 requirements is available in the desktop app.
                </p>
                <p>
                    <UpgradeLink />
                </p>
            </Popover>
        </div>
    );
};

export const TotalScore = ({}: Props) => {
    const globalScore = useGlobalScore();
    const revision = useRevisionContext();
    const score =
        revision === Revision.V2 ? globalScore?.rev2Score : globalScore?.score;
    if (isFreeTier()) {
        return <LevelOneProgress />;
    }
    return (
        <div data-tour="sprs-score">
            <span className="mr-1 text-sm text-muted-foreground">SPRS:</span>
            <span className="mr-2 text-sm font-medium text-foreground">
                {renderNumber(score ?? 0)}/{GlobalScore.maxScore}
            </span>
            {revision === Revision.V3 && (
                <>
                    <button popoverTarget="sprs-popover" aria-label="SPRS info">
                        <IconInfo className="fill-muted-foreground" />
                    </button>
                    <Popover id="sprs-popover">
                        <IconInfo />
                        <p className="my-2">
                            This is the estimated SPRS score calculated by
                            combining the withdrawn revision 2 control values
                            into their revision 3 replacement.
                        </p>
                        <p>
                            Your actual revision 2 score is:{" "}
                            <strong>
                                {renderNumber(globalScore?.rev2Score ?? 0)}
                            </strong>
                        </p>
                    </Popover>
                </>
            )}
        </div>
    );
};
