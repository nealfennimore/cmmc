#!/usr/bin/env node
// One-command model maintenance: re-pins every manifest entry, then fetches
// and verifies the weights into client/public/models/. Run it after any of:
//   - adding or editing a model entry in models.manifest.json
//   - changing the required-file logic in update-model-manifest.mjs
//   - wanting to bump models to their newest upstream revision (--latest)
//
// Usage (inside `nix develop`, network required):
//   node scripts/sync-models.mjs               # re-pin at current revisions, then fetch
//   node scripts/sync-models.mjs --latest      # bump every model to upstream HEAD
//   node scripts/sync-models.mjs --id <id>     # limit to one model
//   node scripts/sync-models.mjs --no-fetch    # manifest only, skip the weight download
//
// Re-pinning at the *current* revision is the default: it is reproducible,
// and it picks up file-set fixes (for example newly-included .onnx_data
// shards) without silently moving to different weights. Review the manifest
// diff like a lockfile change. Nix builds read the manifest directly, so a
// committed manifest is all CI needs.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(
    SCRIPTS,
    "../client/src/app/llm/models.manifest.json",
);

const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};
const latest = args.includes("--latest");
const noFetch = args.includes("--no-fetch");
const onlyId = getArg("id");

const run = (script, scriptArgs) => {
    const result = spawnSync(
        process.execPath,
        [join(SCRIPTS, script), ...scriptArgs],
        { stdio: "inherit" },
    );
    if (result.status !== 0) {
        console.error(`sync-models: ${script} ${scriptArgs.join(" ")} failed`);
        process.exit(result.status ?? 1);
    }
};

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
// LLM entries re-pin with --id, the retrieval embedder with --embedder.
// An embedder with no revision is not published yet (models/embedder/
// publish_hf.sh): its repo does not exist, so it is skipped.
const entries = [
    ...manifest.models.map((model) => ({ model, flag: "--id" })),
    ...(manifest.embedders ?? [])
        .filter((model) => model.revision || onlyId === model.id)
        .map((model) => ({ model, flag: "--embedder" })),
];
const models = entries.filter(({ model }) => !onlyId || model.id === onlyId);
if (!models.length) {
    const known = entries.map(({ model }) => model.id).join(", ");
    console.error(`sync-models: no model matches "${onlyId}". Known: ${known}`);
    process.exit(1);
}

for (const { model, flag } of models) {
    const revisionArgs =
        !latest && model.revision ? ["--revision", model.revision] : [];
    console.log(
        `\n=== ${model.id} (${latest || !model.revision ? "latest revision" : model.revision}) ===`,
    );
    run("update-model-manifest.mjs", [flag, model.id, ...revisionArgs]);
}

if (noFetch) {
    console.log("\nsync-models: manifest updated (--no-fetch: weights skipped)");
} else {
    console.log("\n=== fetching weights into client/public/models/ ===");
    run("fetch-model-weights.mjs", []);
    console.log(
        "\nsync-models: done. Review the models.manifest.json diff before you commit.",
    );
}
