"use client";
import { Revision, useRevisionContext } from "@/app/context/revision";
import { GlobalScore, useGlobalScore } from "@/app/hooks/score";
import { renderNumber } from "@/app/utils/number";
import { IconInfo } from "./icon_info";
import { Popover } from "./popover";

interface Props {
    familyId?: string;
    requirementId?: string;
}

export const TotalScore = ({}: Props) => {
    const globalScore = useGlobalScore();
    const revision = useRevisionContext();
    const score =
        revision === Revision.V2 ? globalScore?.rev2Score : globalScore?.score;
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
