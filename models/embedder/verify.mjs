#!/usr/bin/env node
// Gate for export.sh: load runs/<id>/onnx with the app's own
// transformers.js (client/node_modules, the version the embed worker ships)
// and check that a query ranks the right passage first. A file that fails
// here would fail in the app.
//
//   node verify.mjs
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const id = "granite-embedding-small-english-r2";
const client = join(here, "../../client/node_modules/@huggingface/transformers");
const { env, pipeline } = await import(join(client, "dist/transformers.node.mjs"));

if (!existsSync(join(here, "runs", id, "onnx", "config.json"))) {
    console.error(`FAIL: runs/${id}/onnx is missing. Run ./export.sh first.`);
    process.exit(1);
}
env.allowRemoteModels = false;
env.localModelPath = join(here, "runs", id) + "/";
// Same options as client/src/app/llm/embed_worker.ts.
const extractor = await pipeline("feature-extraction", "onnx", { dtype: "q8", device: "cpu" });

const query = "Use multifactor authentication for network access to non-privileged accounts.";
const passages = [
    "Laptops use BitLocker full-disk encryption with XTS-AES 256.",
    "All remote VPN logins require a Duo push in addition to the user password.",
    "The cafeteria is open from 7 a.m. to 3 p.m. on weekdays.",
];
const output = await extractor([query, ...passages], { pooling: "cls", normalize: true });
const [dims] = output.dims.slice(-1);
const rows = [...Array(passages.length + 1).keys()].map((i) => output.data.slice(i * dims, (i + 1) * dims));
const scores = rows.slice(1).map((row) => row.reduce((sum, value, i) => sum + value * rows[0][i], 0));
console.log(`dims=${dims} scores=${scores.map((s) => s.toFixed(3)).join(", ")}`);
if (dims !== 384) {
    console.error("FAIL: expected 384 dimensions");
    process.exit(1);
}
if (scores.indexOf(Math.max(...scores)) !== 1) {
    console.error("FAIL: the MFA passage does not rank first");
    process.exit(1);
}
console.log("OK: the app runtime loads the export, and it retrieves");
