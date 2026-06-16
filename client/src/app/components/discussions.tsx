"use client";
import { useManifestContext } from "@/app/context/manifest";

export const Discussions = ({ requirementId }) => {
    const manifest = useManifestContext();
    const discussion = manifest?.discussions?.byRequirements[requirementId];
    if (!discussion?.length) {
        return null;
    }

    return (
        <>
            {discussion.map((discussion) => (
                <p
                    className="flex flex-1 flex-col text-base leading-relaxed"
                    key={discussion.element_identifier}
                >
                    {discussion.text}
                </p>
            ))}
        </>
    );
};
