#!/usr/bin/env node
// Regenerates client/src/app/llm/models.manifest.json for one model entry.
//
// The manifest pins every model file (URL, revision, size, sha256) and is the
// single source of truth for three consumers:
//   - flake.nix fetches each file as a fixed-output derivation and bundles
//     the weights into the desktop app.
//   - scripts/fetch-model-weights.mjs fetches and verifies the same files
//     for desktop builds that run outside Nix (Windows/macOS CI, local dev).
//   - client/src/app/llm/config.ts renders sizes and license notices.
// The app itself never downloads weights: they are a build-time input only.
//
// Run inside `nix develop` (needs node >= 18 and network access):
//   node scripts/update-model-manifest.mjs --id llama-3.2-1b-instruct-cmmc
//   node scripts/update-model-manifest.mjs --id llama-3.2-1b-instruct-cmmc-gguf --revision <sha>
//   node scripts/update-model-manifest.mjs --verify
//
// With --id, the script resolves the repo's current revision through the
// Hugging Face API (unless --revision pins one), downloads each required
// file, hashes it, and rewrites that model's entry in place. Where the
// `nix` CLI exists, the download goes through `nix store prefetch-file`,
// so the pinned bytes land in the Nix store and later builds reuse them.
// Treat the diff like a lockfile change. With --verify, the script
// re-downloads every file in the manifest and confirms the recorded hashes
// still match.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(
    ROOT,
    "client/src/app/llm/models.manifest.json",
);

const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// transformers.js's dtype -> ONNX filename suffix mapping (q8 is the
// historical "quantized" name; fp32 has no suffix).
const dtypeSuffix = (dtype) =>
    dtype === "fp32" ? "" : dtype === "q8" ? "_quantized" : `_${dtype}`;

// The ONNX graph file is often tiny: onnx-community repos keep the actual
// weights in external-data siblings (model_<dtype>.onnx_data, possibly
// sharded as _data_1, _data_2, ...). Enumerate the repo's onnx/ tree so the
// manifest pins every shard — a manifest with only the .onnx graph would
// build an app whose model cannot load.
const listOnnxFiles = async (repo, revision, dtype) => {
    const response = await fetchOk(
        `https://huggingface.co/api/models/${repo}/tree/${revision}/onnx`,
    );
    const entries = await response.json();
    const base = `onnx/model${dtypeSuffix(dtype)}.onnx`;
    const files = entries
        .map((entry) => entry.path)
        .filter((path) => path === base || path.startsWith(`${base}_data`))
        .sort();
    if (!files.includes(base)) {
        const available = entries.map((entry) => entry.path).join(", ");
        throw new Error(
            `${base} not found in ${repo}@${revision}. Available: ${available}`,
        );
    }
    return files;
};

// GGUF models (format: "gguf", the native llama.cpp path) are one
// self-contained file: weights, tokenizer, and chat template travel
// together. Quantizer repos name it <Model>-<dtype>.gguf with dtype like
// "Q4_K_M". Exactly one file must match, or the entry is ambiguous.
const listGgufFiles = async (repo, revision, dtype) => {
    const response = await fetchOk(
        `https://huggingface.co/api/models/${repo}/tree/${revision}`,
    );
    const entries = await response.json();
    const files = entries
        .map((entry) => entry.path)
        .filter((path) => path.endsWith(`-${dtype}.gguf`));
    if (files.length !== 1) {
        const available = entries.map((entry) => entry.path).join(", ");
        throw new Error(
            `Expected exactly one *-${dtype}.gguf in ${repo}@${revision}, ` +
                `found ${files.length}. Available: ${available}`,
        );
    }
    return files;
};

// The exact file set the runtime requests. ONNX (transformers.js):
// tokenizer + config + the quantized graph and its external data. GGUF
// (native llama.cpp): the single .gguf file.
const requiredFiles = async (repo, revision, dtype, format) =>
    format === "gguf"
        ? listGgufFiles(repo, revision, dtype)
        : [
              "config.json",
              "generation_config.json",
              "tokenizer.json",
              "tokenizer_config.json",
              ...(await listOnnxFiles(repo, revision, dtype)),
          ];

const resolveUrl = (repo, revision, path) =>
    `https://huggingface.co/${repo}/resolve/${revision}/${path}`;

const fetchOk = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return response;
};

// Stream-download a file, returning its size and sha256 without buffering
// the whole payload (ONNX graphs are hundreds of MB).
const hashRemoteDirect = async (url) => {
    const response = await fetchOk(url);
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of response.body) {
        hash.update(chunk);
        size += chunk.length;
    }
    return { size, sha256: hash.digest("hex") };
};

// Preferred: `nix store prefetch-file` downloads the file once into the Nix
// store and reports its hash. flake.nix fetches the same URL with fetchurl
// (same flat sha256, same store name), so the pinned bytes are already in
// the store — `nix build .#model-weights` and fetch-model-weights.mjs then
// reuse them without a second download.
const hashViaNixStore = (url) => {
    const result = spawnSync(
        "nix",
        ["store", "prefetch-file", "--json", "--hash-type", "sha256", url],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    if (result.status !== 0) {
        throw new Error(`nix store prefetch-file failed for ${url}`);
    }
    const { hash, storePath } = JSON.parse(result.stdout);
    // Nix reports an SRI hash (sha256-<base64>); the manifest records hex.
    const sha256 = Buffer.from(
        hash.replace(/^sha256-/, ""),
        "base64",
    ).toString("hex");
    return { size: statSync(storePath).size, sha256 };
};

const nixAvailable = (() => {
    const probe = spawnSync("nix", ["--version"], { stdio: "ignore" });
    return !probe.error && probe.status === 0;
})();
const hashRemote = nixAvailable ? hashViaNixStore : hashRemoteDirect;

const updateModel = async (id) => {
    const model = manifest.models.find((entry) => entry.id === id);
    if (!model) {
        const known = manifest.models.map((entry) => entry.id).join(", ");
        throw new Error(`Unknown model id "${id}". Known ids: ${known}`);
    }

    const revision =
        getArg("revision") ??
        (
            await (
                await fetchOk(
                    `https://huggingface.co/api/models/${model.repo}`,
                )
            ).json()
        ).sha;
    if (!revision) {
        throw new Error(`Could not resolve a revision for ${model.repo}`);
    }
    console.log(`${model.repo} @ ${revision}`);

    const files = [];
    for (const path of await requiredFiles(
        model.repo,
        revision,
        model.dtype,
        model.format,
    )) {
        const url = resolveUrl(model.repo, revision, path);
        process.stdout.write(`  ${path} ... `);
        const { size, sha256 } = await hashRemote(url);
        console.log(`${(size / 1e6).toFixed(1)} MB ${sha256}`);
        files.push({ path, url, size, sha256 });
    }

    model.revision = revision;
    model.files = files;
    model.totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4) + "\n");
    console.log(`Wrote ${MANIFEST_PATH}`);
};

const verify = async () => {
    let failures = 0;
    for (const model of manifest.models) {
        for (const file of model.files) {
            if (!file.sha256) {
                console.log(`MISSING HASH ${model.id} ${file.path}`);
                failures++;
                continue;
            }
            process.stdout.write(`${model.id} ${file.path} ... `);
            const { sha256 } = await hashRemote(file.url);
            if (sha256 === file.sha256) {
                console.log("ok");
            } else {
                console.log(`MISMATCH (upstream ${sha256})`);
                failures++;
            }
        }
    }
    if (failures) {
        throw new Error(`${failures} file(s) failed verification`);
    }
};

const id = getArg("id");
if (args.includes("--verify")) {
    await verify();
} else if (id) {
    await updateModel(id);
} else {
    console.error(
        "Usage: update-model-manifest.mjs --id <model-id> [--revision <sha>] | --verify",
    );
    process.exit(1);
}
