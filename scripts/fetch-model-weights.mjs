#!/usr/bin/env node
// Stages the pinned model weights into client/public/models/ for desktop
// builds and local dev. Where the `nix` CLI exists, the weights come from
// `nix build .#model-weights`: Nix fetches each file as a fixed-output
// derivation, so the download happens once, lands in the Nix store, and is
// shared across checkouts, rebuilds, and the CI store cache. Where Nix is
// absent (Windows/macOS CI, non-Nix dev machines), the script downloads
// each file directly. Both paths verify every staged file against the
// sha256 in models.manifest.json — the same pins flake.nix uses — and fail
// the build on any mismatch. Unpinned manifest entries (empty sha256) are
// skipped and excluded from builds.
//
// Usage: node scripts/fetch-model-weights.mjs
// Idempotent: files that already exist with the right hash are kept, and
// the Nix build only runs when at least one file is missing or stale.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    copyFileSync,
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "client/src/app/llm/models.manifest.json");
const TARGET_ROOT = join(ROOT, "client/public/models");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// Streaming hash: weight shards run to hundreds of MB, too big to buffer.
const sha256File = async (path) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
};

// Platform-excluded models (bundlePlatforms) count as unlisted here, so
// the prune step below removes their weights from machines that fetched
// them before. Tags are Node process.platform values, optionally
// arch-qualified as "<platform>-<arch>" (darwin-arm64) — the macOS bundles
// differ per arch because llama.cpp's Metal backend is Apple Silicon only.
// Tauri builds run on the target OS, so the local platform/arch are the
// right default signals. Two exceptions use MODELS_PLATFORM: local dev
// ("all" — browser testing of ONNX models on Linux needs weights the
// Linux bundle excludes), and mac CI (one exact tag — it cross-compiles
// x86_64 on arm64 runners, so process.arch lies about the target).
const override = process.env.MODELS_PLATFORM;
const tags = override
    ? [override]
    : [process.platform, `${process.platform}-${process.arch}`];
const pinned = manifest.models.filter(
    (model) =>
        model.revision !== "" &&
        model.files.length > 0 &&
        model.files.every((file) => file.sha256 !== "") &&
        (override === "all" ||
            !model.bundlePlatforms ||
            model.bundlePlatforms.some((tag) => tags.includes(tag))),
);
// No early exit when nothing is bundled: the prune pass below must still
// remove the weights of a dropped model from the target tree.
if (!pinned.length) {
    console.log("fetch-model-weights: no models to bundle for this platform");
}

// First pass: find what is missing or stale, so an up-to-date tree costs
// only local hashing — no Nix evaluation and no network.
const stale = [];
for (const model of pinned) {
    for (const file of model.files) {
        const target = join(TARGET_ROOT, model.repo, file.path);
        if (existsSync(target) && (await sha256File(target)) === file.sha256) {
            console.log(`ok       ${model.repo}/${file.path}`);
        } else {
            stale.push({ model, file, target });
        }
    }
}

// Preferred source: the model-weights derivation. Its fixed-output fetches
// carry the same manifest hashes, so the Nix store keeps one verified copy
// of every weight file. Falls back to a direct download when the nix CLI is
// missing or the build fails (for example, offline with an empty store).
const nixWeightsRoot = () => {
    const probe = spawnSync("nix", ["--version"], { stdio: "ignore" });
    if (probe.error || probe.status !== 0) {
        return null;
    }
    console.log("building .#model-weights (fetches go to the Nix store)");
    const build = spawnSync(
        "nix",
        ["build", ".#model-weights", "--no-link", "--print-out-paths"],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    if (build.status !== 0) {
        console.warn("nix build failed; falling back to direct download");
        return null;
    }
    return build.stdout.trim();
};

const storeRoot = stale.length ? nixWeightsRoot() : null;

for (const { model, file, target } of stale) {
    // Stage through a temp path; only a verified file lands at the target,
    // so an interrupted or corrupt copy can never enter a bundle.
    mkdirSync(dirname(target), { recursive: true });
    const partial = `${target}.partial`;
    if (storeRoot) {
        process.stdout.write(`staging  ${model.repo}/${file.path} ... `);
        copyFileSync(join(storeRoot, model.repo, file.path), partial);
        // Store files are read-only (444); keep the staged copy writable
        // so later syncs can prune or replace it.
        chmodSync(partial, 0o644);
    } else {
        process.stdout.write(`fetching ${model.repo}/${file.path} ... `);
        const response = await fetch(file.url);
        if (!response.ok || !response.body) {
            throw new Error(`${response.status} fetching ${file.url}`);
        }
        await pipeline(
            Readable.fromWeb(response.body),
            createWriteStream(partial),
        );
    }
    const digest = await sha256File(partial);
    if (digest !== file.sha256) {
        rmSync(partial);
        throw new Error(
            `Hash mismatch for ${file.path}: expected ${file.sha256}, got ${digest}`,
        );
    }
    renameSync(partial, target);
    console.log(`${(file.size / 1e6).toFixed(1)} MB verified`);
}

// Prune anything the manifest no longer lists (old revisions, dropped
// models, leftover .partial files) so stale weights never enter a bundle.
const wanted = new Set(
    pinned.flatMap((model) =>
        model.files.map((file) => join(TARGET_ROOT, model.repo, file.path)),
    ),
);
const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(path);
        } else if (!wanted.has(path) && entry.name !== ".gitkeep") {
            // .gitkeep stays: it keeps the Tauri resource source present on
            // fresh clones (see client/.gitignore).
            console.log(`pruning  ${path}`);
            rmSync(path);
        }
    }
};
if (existsSync(TARGET_ROOT)) {
    walk(TARGET_ROOT);
}
console.log(`fetch-model-weights: weights ready in ${TARGET_ROOT}`);
