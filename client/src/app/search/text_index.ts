// Small in-memory ranked text index (BM25) with prefix and light fuzzy
// matching. Hand-rolled instead of a search dependency: the corpora here are
// tiny (~1,100 framework elements, hundreds of evidence files), so a minimal
// inverted index gives the same retrieval quality with zero bundle cost and
// no supply-chain surface — everything stays offline.

// Split on anything that is not a word character, dot, or hyphen, so control
// ids like "03.01.01" survive as single terms, then strip sentence
// punctuation from the edges. Hyphenated compounds ("multi-factor") emit
// their parts plus the joined spelling; applied to documents and queries
// alike, this makes "multifactor", "multi-factor", and "multi factor" all
// find each other. Single characters are noise at this corpus size.
export const tokenize = (text: string): string[] => {
    const terms: string[] = [];
    for (const raw of text.toLowerCase().split(/[^\w.-]+/)) {
        const term = raw.replace(/^[.-]+|[.-]+$/g, "");
        if (term.length <= 1) {
            continue;
        }
        if (term.includes("-")) {
            terms.push(
                ...term.split("-").filter((part) => part.length > 1),
                term.replace(/-/g, ""),
            );
        } else {
            terms.push(term);
        }
    }
    return terms;
};

// Standard BM25 constants: k1 saturates repeated terms, b normalizes for
// field length.
const K1 = 1.2;
const B = 0.7;

// Query-term expansion weights. Exact hits count fully; prefix hits fade with
// how much of the indexed term the query covers; fuzzy hits (one typo) count
// least so they never outrank literal matches.
const PREFIX_WEIGHT = 0.6;
const FUZZY_WEIGHT = 0.45;
const MIN_PREFIX_LENGTH = 2;
const MIN_FUZZY_LENGTH = 5;

const withinOneEdit = (a: string, b: string): boolean => {
    if (Math.abs(a.length - b.length) > 1) {
        return false;
    }
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        if (++edits > 1) {
            return false;
        }
        if (a.length === b.length) {
            i++;
            j++;
        } else if (a.length > b.length) {
            i++;
        } else {
            j++;
        }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
};

export interface TextIndexHit {
    id: string;
    score: number;
}

export class TextIndex {
    private readonly fields: string[];
    private readonly boosts: number[];
    /** term -> doc id -> term frequency per field (aligned with fields). */
    private readonly postings = new Map<string, Map<string, number[]>>();
    /** doc id -> token count per field. */
    private readonly docs = new Map<string, number[]>();
    private readonly totalLength: number[];

    constructor(fields: string[], boosts: Record<string, number> = {}) {
        this.fields = fields;
        this.boosts = fields.map((field) => boosts[field] ?? 1);
        this.totalLength = fields.map(() => 0);
    }

    add(id: string, content: Record<string, string | undefined>): void {
        const lengths = this.fields.map(() => 0);
        this.fields.forEach((field, fieldIndex) => {
            const terms = tokenize(content[field] ?? "");
            lengths[fieldIndex] = terms.length;
            this.totalLength[fieldIndex] += terms.length;
            for (const term of terms) {
                let byDoc = this.postings.get(term);
                if (!byDoc) {
                    byDoc = new Map();
                    this.postings.set(term, byDoc);
                }
                let counts = byDoc.get(id);
                if (!counts) {
                    counts = this.fields.map(() => 0);
                    byDoc.set(id, counts);
                }
                counts[fieldIndex]++;
            }
        });
        this.docs.set(id, lengths);
    }

    /** Ranked search. Every query term must match (AND), each through the
     *  best of its exact/prefix/fuzzy expansions. */
    search(query: string, limit = 10): TextIndexHit[] {
        const queryTerms = [...new Set(tokenize(query))];
        if (!queryTerms.length || !this.docs.size) {
            return [];
        }

        const docCount = this.docs.size;
        const avgLength = this.totalLength.map(
            (total) => total / docCount || 1,
        );

        // Per query term, the best-scoring expansion per document.
        let intersection: Map<string, number> | undefined;
        for (const queryTerm of queryTerms) {
            const byDoc = new Map<string, number>();
            for (const [term, docTfs] of this.postings) {
                const weight = this.matchWeight(queryTerm, term);
                if (weight === 0) {
                    continue;
                }
                const idf = Math.log(
                    1 + (docCount - docTfs.size + 0.5) / (docTfs.size + 0.5),
                );
                for (const [id, counts] of docTfs) {
                    const lengths = this.docs.get(id)!;
                    let score = 0;
                    counts.forEach((tf, fieldIndex) => {
                        if (!tf) {
                            return;
                        }
                        const norm =
                            tf +
                            K1 *
                                (1 -
                                    B +
                                    (B * lengths[fieldIndex]) /
                                        avgLength[fieldIndex]);
                        score += this.boosts[fieldIndex] * ((tf * idf) / norm);
                    });
                    score *= weight;
                    byDoc.set(id, Math.max(byDoc.get(id) ?? 0, score));
                }
            }
            if (!intersection) {
                intersection = byDoc;
                continue;
            }
            const next = new Map<string, number>();
            for (const [id, score] of byDoc) {
                const previous = intersection.get(id);
                if (previous !== undefined) {
                    next.set(id, previous + score);
                }
            }
            intersection = next;
            if (!intersection.size) {
                return [];
            }
        }

        return [...intersection!]
            .map(([id, score]) => ({ id, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private matchWeight(queryTerm: string, term: string): number {
        if (term === queryTerm) {
            return 1;
        }
        if (
            queryTerm.length >= MIN_PREFIX_LENGTH &&
            term.startsWith(queryTerm)
        ) {
            return PREFIX_WEIGHT * (queryTerm.length / term.length);
        }
        if (
            queryTerm.length >= MIN_FUZZY_LENGTH &&
            withinOneEdit(queryTerm, term)
        ) {
            return FUZZY_WEIGHT;
        }
        return 0;
    }
}
