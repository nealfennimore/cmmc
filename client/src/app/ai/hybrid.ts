// Retrieval math: dense ranking by cosine similarity (what the app uses),
// and reciprocal rank fusion (RRF) of several rankings. The app does not
// fuse: on the eval, every fused variant ranked below dense alone. RRF
// stays here for scripts/eval-retrieval.mjs, which reports the fused
// variants so that new evidence can reopen the question. Pure functions
// with no runtime imports, so the eval runs this exact code in Node. See
// docs/embedding-retrieval-plan.md.

/** Bump when retrieval changes in a way that changes review output: it is
 *  part of the review fingerprint (ai/review.ts). */
export const RETRIEVAL_VERSION = 2;

/** RRF constant. 60 is the value from the original RRF paper (Cormack et
 *  al., 2009). It damps the weight of the first ranks, so one ranking
 *  alone cannot decide the order. */
export const RRF_K = 60;

/** Dot product. The embedder returns unit vectors, so this is the cosine
 *  similarity. */
export const dot = (a: Float32Array, b: Float32Array): number => {
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        sum += a[i] * b[i];
    }
    return sum;
};

/** Ids in order of similarity to the query, most similar first. Ties keep
 *  the input order, so the result is deterministic. */
export const rankByVector = (
    query: Float32Array,
    items: { id: string; vector: Float32Array }[],
): string[] =>
    items
        .map((item, index) => ({
            id: item.id,
            index,
            score: dot(query, item.vector),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((item) => item.id);

/** RRF: score(id) = sum over rankings of weight / (k + rank), rank from 1.
 *  The weight of each ranking is 1 unless `weights` gives one. An id that a
 *  ranking does not contain gets no term from that ranking. BM25 returns
 *  only chunks with a shared term, and the dense ranking contains every
 *  chunk. */
export const fuseRankings = (
    rankings: string[][],
    k = RRF_K,
    weights: number[] = [],
): Map<string, number> => {
    const scores = new Map<string, number>();
    rankings.forEach((ranking, which) => {
        const weight = weights[which] ?? 1;
        ranking.forEach((id, index) => {
            scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1));
        });
    });
    return scores;
};

/** Fused ids, best first. Ties keep the order of the first ranking that
 *  contains the id (BM25 first, by convention of the callers). */
export const fusedOrder = (
    rankings: string[][],
    k = RRF_K,
    weights: number[] = [],
): string[] => {
    const scores = fuseRankings(rankings, k, weights);
    const firstSeen = new Map<string, number>();
    let position = 0;
    for (const ranking of rankings) {
        for (const id of ranking) {
            if (!firstSeen.has(id)) {
                firstSeen.set(id, position++);
            }
        }
    }
    return [...scores.keys()].sort(
        (a, b) =>
            scores.get(b)! - scores.get(a)! ||
            firstSeen.get(a)! - firstSeen.get(b)!,
    );
};

// Dev console assertions, in the style of utils/tier.ts.
if (process.env.NODE_ENV === "development") {
    const unit = (values: number[]) => {
        const norm = Math.hypot(...values);
        return Float32Array.from(values, (value) => value / norm);
    };
    console.assert(
        Math.abs(dot(unit([1, 2, 3]), unit([1, 2, 3])) - 1) < 1e-6,
        "hybrid: dot of a unit vector with itself is 1",
    );
    console.assert(
        rankByVector(unit([1, 0]), [
            { id: "far", vector: unit([0, 1]) },
            { id: "near", vector: unit([1, 0.1]) },
        ]).join() === "near,far",
        "hybrid: rankByVector puts the most similar item first",
    );
    // "b" is second in both rankings, "a" is first in one only: two
    // middling ranks beat one top rank.
    console.assert(
        fusedOrder([
            ["a", "b"],
            ["c", "b"],
        ])[0] === "b",
        "hybrid: fusedOrder rewards agreement between rankings",
    );
    console.assert(
        Math.abs(fuseRankings([["x"]]).get("x")! - 1 / 61) < 1e-12,
        "hybrid: RRF score of rank 1 is 1 / (k + 1)",
    );
    console.assert(
        fusedOrder(
            [
                ["a", "b"],
                ["b", "a"],
            ],
            RRF_K,
            [1, 2],
        )[0] === "b",
        "hybrid: a higher weight gives that ranking the tie",
    );
}
