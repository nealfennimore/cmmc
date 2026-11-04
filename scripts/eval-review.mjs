#!/usr/bin/env node
// Review evaluation: are the objective-review verdicts right? It runs the
// app's own review prompt builder and parser (client/src/app/ai/prompt.ts)
// on the labeled cases in
// models/finetune/pipeline/fixtures/retrieval_cases.json, with an ONNX LLM
// through the app's transformers.js, and the dense retrieval the app uses.
//
// Two cases per objective:
//   full      every chunk of the requirement. The fixture labels at least
//             one chunk as relevant to the objective, so the expected verdict
//             is positive: met (or partially-met).
//   withheld  the same pool without the objective's relevant chunks. The
//             expected verdict is negative: no-evidence or not-met. A "met"
//             here is a false pass, the worst error for a compliance tool.
//
// The prompts carry no document summaries (the summary-context setting
// off). Decoding matches the app: greedy, repetition penalty 1.1, 320 new
// tokens, one user message.
//
// Usage (from the repo root; CPU, so a run takes minutes):
//   node scripts/eval-review.mjs --model-dir models/finetune/pipeline/runs/llama-3.2-1b-instruct/onnx
//   node scripts/eval-review.mjs --model-dir <dir> --dtype q4f16 --limit 4 --out /tmp/review.jsonl
//
// The embedder comes from client/public/models (npm run models), or from
// --embedder-dir. The native desktop path runs the GGUF of the same model
// through llama.cpp; its verdicts can differ a little from this ONNX run.

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client");
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

const modelDir = getArg("model-dir");
if (!modelDir || !existsSync(join(resolve(modelDir), "config.json"))) {
    console.error(
        "usage: node scripts/eval-review.mjs --model-dir <ONNX model dir with config.json> [--dtype q4f16] [--limit N] [--out file.jsonl] [--embedder-dir <dir>]",
    );
    process.exit(1);
}
const dtype = getArg("dtype") ?? "q4f16";
const limit = Number(getArg("limit") ?? Infinity);
const outPath = getArg("out");

// --- App code through jiti: the @/ alias, and a stub for the one JSX module
// on the import path (context/revision.tsx; only its enum is needed).
const require = createRequire(join(CLIENT, "package.json"));
const revisionStub = join(tmpdir(), "cmmc-eval-revision-stub.cjs");
writeFileSync(revisionStub, 'exports.Revision = { V2: "R2", V3: "R3" };\n');
const jiti = require("jiti")(import.meta.url, {
    alias: {
        "@/app/context/revision": revisionStub,
        "@/": join(CLIENT, "src") + "/",
    },
    interopDefault: true,
    extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
});
const { buildReviewPrompt, parseReviewResponse } = jiti(
    join(CLIENT, "src/app/ai/prompt.ts"),
);
const { rankByVector } = await import(
    pathToFileURL(join(CLIENT, "src/app/ai/hybrid.ts")).href
);
const { env, pipeline, AutoTokenizer, AutoModelForCausalLM } = await import(
    pathToFileURL(
        join(
            CLIENT,
            "node_modules/@huggingface/transformers/dist/transformers.node.mjs",
        ),
    ).href
);

const fixture = JSON.parse(
    readFileSync(
        join(ROOT, "models/finetune/pipeline/fixtures/retrieval_cases.json"),
        "utf8",
    ),
);
const manifest = JSON.parse(
    readFileSync(join(CLIENT, "src/app/llm/models.manifest.json"), "utf8"),
);
const embedderEntry = manifest.embedders?.[0];

env.allowRemoteModels = false;

// --- Embedder (same options as llm/embed_worker.ts).
const embedderDir = resolve(
    getArg("embedder-dir") ??
        join(CLIENT, "public/models", embedderEntry?.repo ?? "missing"),
);
if (!existsSync(join(embedderDir, "config.json"))) {
    console.error(
        `No embedder at ${embedderDir}. Run npm run models in client/, or pass --embedder-dir.`,
    );
    process.exit(1);
}
env.localModelPath = dirname(embedderDir) + "/";
const extractor = await pipeline("feature-extraction", basename(embedderDir), {
    dtype: "q8",
    device: "cpu",
});
const embed = async (texts) => {
    const output = await extractor(texts, {
        pooling: embedderEntry?.pooling ?? "cls",
        normalize: true,
    });
    const dims = output.dims[output.dims.length - 1];
    return texts.map((_, i) => output.data.slice(i * dims, (i + 1) * dims));
};

// --- LLM (same options as llm/worker.ts).
const llmDir = resolve(modelDir);
env.localModelPath = dirname(llmDir) + "/";
const shards = readdirSync(join(llmDir, "onnx")).filter((f) =>
    f.includes(".onnx_data"),
).length;
const tokenizer = await AutoTokenizer.from_pretrained(basename(llmDir));
const llm = await AutoModelForCausalLM.from_pretrained(basename(llmDir), {
    dtype,
    device: "cpu",
    use_external_data_format: shards,
});
const countTokens = (text) => tokenizer.encode(text).length;

const generate = async (prompt) => {
    const inputs = tokenizer.apply_chat_template(
        [{ role: "user", content: prompt }],
        { add_generation_prompt: true, return_dict: true },
    );
    const output = await llm.generate({
        ...inputs,
        max_new_tokens: 320,
        do_sample: false,
        repetition_penalty: 1.1,
    });
    return tokenizer.batch_decode(
        output.slice(null, [inputs.input_ids.dims[1], null]),
        { skip_special_tokens: true },
    )[0];
};

// --- Chunks in the app's RetrievedChunk shape. seq counts per file, so the
// prompt's [SOURCE: file#n] tags look like the app's.
const chunksFor = (requirement) => {
    const perFile = new Map();
    return requirement.chunks.map((chunk) => {
        const seq = perFile.get(chunk.filename) ?? 0;
        perFile.set(chunk.filename, seq + 1);
        return {
            id: chunk.id,
            evidenceId: chunk.filename,
            seq,
            text: chunk.text,
            filename: chunk.filename,
            score: 0,
        };
    });
};

const vectors = new Map();
for (const requirement of fixture.requirements) {
    const rows = await embed(requirement.chunks.map((chunk) => chunk.text));
    requirement.chunks.forEach((chunk, i) => vectors.set(chunk.id, rows[i]));
}

const POSITIVE = new Set(["met", "partially-met"]);
const NEGATIVE = new Set(["no-evidence", "not-met"]);
const results = [];
let done = 0;
const total = Math.min(
    limit,
    fixture.requirements.reduce((n, r) => n + r.objectives.length, 0),
);
const started = performance.now();

outer: for (const requirement of fixture.requirements) {
    const all = chunksFor(requirement);
    for (const objective of requirement.objectives) {
        if (done >= limit) {
            break outer;
        }
        const [query] = await embed([
            `${objective.text} ${objective.requirementStatement}`,
        ]);
        for (const kind of ["full", "withheld"]) {
            const pool =
                kind === "full"
                    ? all
                    : all.filter((chunk) => !objective.relevant.includes(chunk.id));
            // Same as retrieveForObjective: dense order, top limit * 2 = 16.
            const order = rankByVector(
                query,
                pool.map((chunk) => ({ id: chunk.id, vector: vectors.get(chunk.id) })),
            ).slice(0, 16);
            const byId = new Map(pool.map((chunk) => [chunk.id, chunk]));
            const retrieved = order.map((id) => byId.get(id));
            const { prompt, included } = buildReviewPrompt(
                objective,
                retrieved,
                { contextTokens: 2560, countTokens },
                [],
            );
            const raw = await generate(prompt);
            const parsed = parseReviewResponse(raw, included);
            const quoteChunk = parsed.quote?.verified
                ? included.find(
                      (chunk) =>
                          chunk.filename === parsed.quote.filename &&
                          chunk.seq === parsed.quote.chunk,
                  )
                : undefined;
            results.push({
                requirementId: requirement.requirementId,
                objective: objective.id,
                kind,
                verdict: parsed.verdict,
                reason: parsed.reason,
                quote: parsed.quote?.text,
                quoteVerified: !!parsed.quote?.verified,
                quoteRelevant:
                    !!quoteChunk && objective.relevant.includes(quoteChunk.id),
                included: included.map((chunk) => chunk.id),
                relevantIncluded: objective.relevant.filter((id) =>
                    included.some((chunk) => chunk.id === id),
                ).length,
                raw,
            });
        }
        done++;
        const elapsed = (performance.now() - started) / 1000;
        process.stdout.write(
            `\r${done}/${total} objectives, ${elapsed.toFixed(0)} s   `,
        );
    }
}
console.log("");

if (outPath) {
    writeFileSync(
        outPath,
        results.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    console.log(`wrote ${outPath}`);
}

// --- Report.
const share = (rows, test) =>
    rows.length ? rows.filter(test).length / rows.length : NaN;
const pct = (value) => (Number.isNaN(value) ? "  —  " : `${(100 * value).toFixed(0).padStart(3)}%`);
const full = results.filter((row) => row.kind === "full");
const withheld = results.filter((row) => row.kind === "withheld");
const quoted = results.filter((row) => row.quote);
const fullQuotedVerified = full.filter((row) => row.quoteVerified);

console.log(`\nmodel: ${llmDir} (${dtype}), ${full.length} objectives`);
console.log("\nfull cases (evidence present, expected met):");
console.log(`  met                  ${pct(share(full, (r) => r.verdict === "met"))}`);
console.log(`  met or partially-met ${pct(share(full, (r) => POSITIVE.has(r.verdict)))}`);
console.log(`  relevant chunk in prompt ${pct(share(full, (r) => r.relevantIncluded > 0))}`);
console.log("\nwithheld cases (relevant chunks removed, expected no-evidence or not-met):");
console.log(`  correct negative     ${pct(share(withheld, (r) => NEGATIVE.has(r.verdict)))}`);
console.log(`  FALSE met            ${pct(share(withheld, (r) => r.verdict === "met"))}`);
console.log(`  partially-met        ${pct(share(withheld, (r) => r.verdict === "partially-met"))}`);
console.log("\nall cases:");
console.log(
    `  balanced accuracy    ${pct((share(full, (r) => POSITIVE.has(r.verdict)) + share(withheld, (r) => NEGATIVE.has(r.verdict))) / 2)}`,
);
console.log(`  unparsed or error    ${pct(share(results, (r) => r.verdict === "unparsed" || r.verdict === "error"))}`);
console.log(`  quote verified       ${pct(share(quoted, (r) => r.quoteVerified))} of ${quoted.length} quotes`);
console.log(
    `  verified quote from a relevant chunk (full) ${pct(share(fullQuotedVerified, (r) => r.quoteRelevant))}`,
);

console.log("\nper objective (full / withheld):");
for (const id of [...new Set(results.map((row) => row.objective))]) {
    const f = full.find((row) => row.objective === id);
    const w = withheld.find((row) => row.objective === id);
    const mark = (row, good) => (good.has(row?.verdict) ? " " : "!");
    console.log(
        `  ${id.padEnd(12)} ${mark(f, POSITIVE)}${(f?.verdict ?? "—").padEnd(14)} ${mark(w, NEGATIVE)}${w?.verdict ?? "—"}`,
    );
}
console.log(
    "\n! marks an unexpected verdict. A withheld 'met' can still be right when another chunk truly covers the objective and the label missed it: read its quote in --out before you count it as an error.",
);
