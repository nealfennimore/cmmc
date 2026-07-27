"use client";
import { toPath, useRevisionContext } from "@/app/context/revision";
import {
    globalSearchHref,
    globalSearchOptions,
} from "@/app/search/global_options";
import { useRouter } from "next/navigation";
import { SearchDropdown } from "./search_dropdown";

/**
 * Ranked search across the current revision's requirements and the user's
 * evidence. Requirement hits open the requirement page; evidence hits open
 * the evidence table pre-filtered to the query.
 */
export const GlobalSearch = () => {
    const revision = useRevisionContext();
    const path = toPath(revision);
    const router = useRouter();

    return (
        <SearchDropdown
            search={(query) => globalSearchOptions(revision, query)}
            placeholder="Search requirements and evidence…"
            onSelect={(option, setQuery) => {
                router.push(globalSearchHref(path, option.value));
                setQuery("");
            }}
        />
    );
};
