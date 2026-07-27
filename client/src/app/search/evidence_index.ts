"use client";
import { IDB, TABLE_CHANGED_EVENT } from "@/app/db";
import { TextIndex } from "./text_index";

export interface EvidenceHit {
    id: string;
    filename: string;
    score: number;
}

interface EvidenceSearch {
    index: TextIndex;
    filenames: Map<string, string>;
}

// Cached until any table feeding the index changes; the listener just drops
// the cache and the next query rebuilds. Rebuilds are proportional to stored
// text, trivial at the realistic corpus size (hundreds of artifacts).
let cache: Promise<EvidenceSearch> | undefined;
let listening = false;

const build = async (): Promise<EvidenceSearch> => {
    const [artifacts, texts, links] = await Promise.all([
        IDB.evidence.getAll(),
        IDB.evidenceText.getAll(),
        IDB.evidenceRequirements.getAll(),
    ]);

    const textById = new Map(texts.map((row) => [row.id, row.text]));
    const requirementsById = new Map<string, string[]>();
    for (const link of links) {
        let ids = requirementsById.get(link.evidence_id);
        if (!ids) {
            ids = [];
            requirementsById.set(link.evidence_id, ids);
        }
        ids.push(link.requirement_id);
    }

    // Filenames outrank body text (a file named for the topic is the
    // strongest signal); linked requirement ids let "03.01.01" surface the
    // evidence already attached to that control.
    const index = new TextIndex(["filename", "text", "requirements"], {
        filename: 3,
        requirements: 2,
    });
    const filenames = new Map<string, string>();
    for (const artifact of artifacts) {
        index.add(artifact.id, {
            filename: artifact.filename,
            text: textById.get(artifact.id),
            requirements: requirementsById.get(artifact.id)?.join(" "),
        });
        filenames.set(artifact.id, artifact.filename);
    }
    return { index, filenames };
};

const getEvidenceSearch = (): Promise<EvidenceSearch> => {
    if (!listening && typeof window !== "undefined") {
        listening = true;
        const feeding = new Set<string>([
            IDB.evidence.table,
            IDB.evidenceText.table,
            IDB.evidenceRequirements.table,
        ]);
        window.addEventListener(TABLE_CHANGED_EVENT, (event) => {
            const detail = (event as CustomEvent<{ table?: string }>).detail;
            if (detail?.table && feeding.has(detail.table)) {
                cache = undefined;
            }
        });
    }
    if (!cache) {
        cache = build();
    }
    return cache;
};

/** Ranked content search across evidence filenames, extracted text, and
 *  linked requirement ids. */
export const searchEvidence = async (
    query: string,
    limit = 10,
): Promise<EvidenceHit[]> => {
    if (!query.trim()) {
        return [];
    }
    const { index, filenames } = await getEvidenceSearch();
    return index.search(query, limit).map((hit) => ({
        id: hit.id,
        filename: filenames.get(hit.id) ?? "",
        score: hit.score,
    }));
};

/** All matching evidence ids for filtering the evidence table, or null when
 *  the query is empty (no filter). */
export const evidenceMatchIds = async (
    query: string,
): Promise<Set<string> | null> => {
    if (!query.trim()) {
        return null;
    }
    const { index } = await getEvidenceSearch();
    return new Set(
        index.search(query, Number.MAX_SAFE_INTEGER).map((hit) => hit.id),
    );
};
