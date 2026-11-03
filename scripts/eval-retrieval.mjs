#!/usr/bin/env node
// Retrieval evaluation, the gate for embedding retrieval
// (docs/embedding-retrieval-plan.md, "Verification"). For each labeled
// objective in models/finetune/pipeline/fixtures/retrieval_cases.json, it
// ranks the chunks several ways and reports recall@4, recall@8, and MRR:
//   bm25    the app's TextIndex.searchAny with the review query (the
//           app's fallback when the embedder is not available)
//   dense   cosine similarity of embeddings, the shipped ranking
//   hybrid* RRF (k = 60) of bm25 and dense, kept so that new evidence can
//           reopen the fusion question
//
// It runs the app's own code (search/text_index.ts, ai/hybrid.ts) through
// Node type stripping, and the app's transformers.js for the embeddings.
//
// Two candidate pools:
//   requirement  the chunks of that requirement only (the app's case)
//   all          the chunks of every requirement (harder: more distractors)
//
// Gate, in each pool: recall@8 >= bm25 recall@8 for every requirement, and
// higher overall (equal is enough when bm25 is already 1). The exit code
// follows the shipped method ("dense"). The fused variants (a lean BM25
// query, and RRF with weight 2 on the dense ranking) get a gate line each,
// plus a comparison with dense.
//
// Usage (from the repo root, network needed on the first run only):
//   node scripts/eval-retrieval.mjs
//   node scripts/eval-retrieval.mjs --model onnx-community/granite-embedding-small-english-r2-ONNX
//   node scripts/eval-retrieval.mjs --local-dir models/embedder/runs/granite-embedding-small-english-r2/onnx
//
// Without --model, the script uses the manifest embedder from
// client/public/models/ when its weights are there. Otherwise it falls
// back to the onnx-community export of the same IBM weights. That export
// is for measurement only. The app ships our own export (models/embedder).

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The client package has no "type" field, so Node warns when it loads the
// app's .ts modules as ES modules. The warning is noise here.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
    if (warning.code !== "MODULE_TYPELESS_PACKAGE_JSON") {
        console.warn(warning);
    }
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client");
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

const { TextIndex } = await import(
    pathToFileURL(join(CLIENT, "src/app/search/text_index.ts")).href
);
const { fusedOrder, rankByVector } = await import(
    pathToFileURL(join(CLIENT, "src/app/ai/hybrid.ts")).href
);
const { env, pipeline } = await import(
    pathToFileURL(
        join(
            CLIENT,
            "node_modules/@huggingface/transformers/dist/transformers.node.mjs",
        ),
    ).href
);

const manifest = JSON.parse(
    readFileSync(join(CLIENT, "src/app/llm/models.manifest.json"), "utf8"),
);
const embedder = manifest.embedders?.[0];
const localWeights =
    embedder &&
    existsSync(join(CLIENT, "public/models", embedder.repo, "config.json"));
// --local-dir: an export folder on disk (models/embedder/export.sh output),
// checked before it is published.
const localDir = getArg("local-dir");
let repo =
    getArg("model") ??
    (localWeights
        ? embedder.repo
        : "onnx-community/granite-embedding-small-english-r2-ONNX");
if (localDir) {
    const dir = resolve(localDir);
    if (!existsSync(join(dir, "config.json"))) {
        console.error(`--local-dir: no config.json in ${dir}`);
        process.exit(1);
    }
    env.localModelPath = dirname(dir) + "/";
    env.allowRemoteModels = false;
    repo = basename(dir);
} else if (repo === embedder?.repo && localWeights) {
    env.localModelPath = join(CLIENT, "public/models") + "/";
    env.allowRemoteModels = false;
}
const pooling = embedder?.pooling ?? "cls";
const queryPrefix = embedder?.queryPrefix ?? "";
const passagePrefix = embedder?.passagePrefix ?? "";

const fixture = JSON.parse(
    readFileSync(
        join(ROOT, "models/finetune/pipeline/fixtures/retrieval_cases.json"),
        "utf8",
    ),
);

console.log(
    `embedder: ${localDir ? resolve(localDir) : repo} (q8, pooling ${pooling})`,
);
const extractor = await pipeline("feature-extraction", repo, {
    dtype: "q8",
    device: "cpu",
});
const embed = async (texts) => {
    const output = await extractor(texts, { pooling, normalize: true });
    const dims = output.dims[output.dims.length - 1];
    return texts.map((_, i) => output.data.slice(i * dims, (i + 1) * dims));
};

const allChunks = fixture.requirements.flatMap((requirement) =>
    requirement.chunks.map((chunk) => ({
        ...chunk,
        requirementId: requirement.requirementId,
    })),
);
const started = performance.now();
const vectors = new Map();
for (let i = 0; i < allChunks.length; i += 8) {
    const batch = allChunks.slice(i, i + 8);
    const rows = await embed(batch.map((chunk) => passagePrefix + chunk.text));
    batch.forEach((chunk, j) => vectors.set(chunk.id, rows[j]));
}
const perChunkMs = (performance.now() - started) / allChunks.length;

// Same query split as ai/retrieval.ts retrieveForObjective. "lean" is the
// variant without the method terms and considerations: objective and
// requirement statement only, the same text as the dense query.
const bm25Rank = (objective, chunks, { lean = false } = {}) => {
    const index = new TextIndex(["text", "filename"], { filename: 2 });
    for (const chunk of chunks) {
        index.add(chunk.id, { text: chunk.text, filename: chunk.filename });
    }
    const query = (
        lean
            ? [objective.text, objective.requirementStatement]
            : [
                  objective.text,
                  objective.requirementStatement,
                  ...objective.methodTerms,
                  ...objective.considerations,
              ]
    ).join(" ");
    return index.searchAny(query, chunks.length).map((hit) => hit.id);
};

const recallAt = (ranking, relevant, k) =>
    relevant.filter((id) => ranking.slice(0, k).includes(id)).length /
    relevant.length;
const reciprocalRank = (ranking, relevant) => {
    const index = ranking.findIndex((id) => relevant.includes(id));
    return index < 0 ? 0 : 1 / (index + 1);
};
const mean = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

// Rankings per method. "dense" is what the app ships. The hybrid rows are
// fused variants; "w2" gives the dense ranking weight 2 in RRF.
const METHODS = {
    bm25: (r) => r.bm25,
    "bm25-lean": (r) => r.bm25Lean,
    dense: (r) => r.dense,
    hybrid: (r) => fusedOrder([r.bm25, r.dense]),
    "hybrid-lean": (r) => fusedOrder([r.bm25Lean, r.dense]),
    "hybrid-w2": (r) => fusedOrder([r.bm25, r.dense], 60, [1, 2]),
    "hybrid-lean-w2": (r) => fusedOrder([r.bm25Lean, r.dense], 60, [1, 2]),
};
const CANDIDATES = Object.keys(METHODS).filter((m) => !m.startsWith("bm25"));
const SHIPPED = "dense";
const f2 = (value) => value.toFixed(2);
let failed = false;

for (const pool of ["requirement", "all"]) {
    // scores[method][requirementId] = { r4: [], r8: [], rr: [] }
    const scores = Object.fromEntries(Object.keys(METHODS).map((m) => [m, {}]));
    for (const requirement of fixture.requirements) {
        const chunks =
            pool === "all"
                ? allChunks
                : allChunks.filter(
                      (chunk) =>
                          chunk.requirementId === requirement.requirementId,
                  );
        for (const m of Object.keys(METHODS)) {
            scores[m][requirement.requirementId] = { r4: [], r8: [], rr: [] };
        }
        for (const objective of requirement.objectives) {
            const [query] = await embed([
                queryPrefix +
                    `${objective.text} ${objective.requirementStatement}`,
            ]);
            const base = {
                bm25: bm25Rank(objective, chunks),
                bm25Lean: bm25Rank(objective, chunks, { lean: true }),
                dense: rankByVector(
                    query,
                    chunks.map((chunk) => ({
                        id: chunk.id,
                        vector: vectors.get(chunk.id),
                    })),
                ),
            };
            for (const [m, rank] of Object.entries(METHODS)) {
                const ranking = rank(base);
                const target = scores[m][requirement.requirementId];
                target.r4.push(recallAt(ranking, objective.relevant, 4));
                target.r8.push(recallAt(ranking, objective.relevant, 8));
                target.rr.push(reciprocalRank(ranking, objective.relevant));
            }
        }
    }

    const ids = fixture.requirements.map((r) => r.requirementId);
    const overall = (m, key) =>
        mean(ids.flatMap((id) => scores[m][id][key]));
    console.log(`\npool: ${pool}`);
    console.log(
        `${"method".padEnd(15)} r@4  r@8  MRR  | r@8 per requirement: ${ids.join("  ")}`,
    );
    for (const m of Object.keys(METHODS)) {
        const perRequirement = ids
            .map((id) => f2(mean(scores[m][id].r8)).padEnd(id.length))
            .join("  ");
        console.log(
            `${m.padEnd(15)} ${f2(overall(m, "r4"))} ${f2(overall(m, "r8"))} ${f2(overall(m, "rr"))} |                      ${perRequirement}`,
        );
    }

    // Gate per candidate: recall@8 >= bm25 for every requirement, and
    // higher overall (equal is enough when bm25 is already 1). The decision
    // rule from the plan: BM25 leaves the fusion if dense matches or beats
    // the hybrid on recall@8 and MRR.
    const bm25R8 = overall("bm25", "r8");
    console.log("");
    for (const m of CANDIDATES) {
        const worse = ids.filter(
            (id) => mean(scores[m][id].r8) < mean(scores.bm25[id].r8) - 1e-9,
        );
        const r8 = overall(m, "r8");
        const pass =
            !worse.length && (r8 > bm25R8 || (bm25R8 === 1 && r8 === 1));
        const vsDense =
            m === "dense"
                ? ""
                : r8 >= overall("dense", "r8") &&
                    overall(m, "rr") >= overall("dense", "rr")
                  ? ", matches or beats dense"
                  : ", below dense";
        console.log(
            `gate ${m.padEnd(15)} ${pass ? "PASS" : "FAIL"}${worse.length ? ` (below bm25: ${worse.join(", ")})` : ""}${vsDense}`,
        );
        if (m === SHIPPED && !pass) {
            failed = true;
        }
    }
}

console.log(
    `\nembedding time: ${perChunkMs.toFixed(1)} ms per chunk (Node CPU, batches of 8; the app's WASM worker is slower)`,
);
console.log(
    failed
        ? `\nGATE (${SHIPPED}, shipped): FAIL`
        : `\nGATE (${SHIPPED}, shipped): PASS`,
);
process.exit(failed ? 1 : 0);
