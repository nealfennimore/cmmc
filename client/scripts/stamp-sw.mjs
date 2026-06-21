// Replaces the __BUILD_ID__ placeholder in the exported service worker with a
// per-build cache name, so a deploy automatically invalidates the old cache
// (the SW's activate handler deletes any cache whose name != cacheName).
//
// The id is `<version>-<shortSha>`: version matches the footer (APP_VERSION tag,
// else package.json), and the commit ensures any rebuild also busts the cache.
// Both inputs are reproducible (no timestamps/randomness). Runs as npm postbuild,
// after `next build`, with cwd = client.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SW = "out/sw.js";

function shortSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Built outside a git checkout; CI still exposes the commit via GITHUB_SHA.
    return process.env.GITHUB_SHA?.slice(0, 8) ?? "";
  }
}

const { version: pkgVersion } = JSON.parse(
  readFileSync("package.json", "utf8"),
);
const version = process.env.APP_VERSION?.replace(/^v/, "") || pkgVersion;
const buildId = [version, shortSha()].filter(Boolean).join("-");

const src = readFileSync(SW, "utf8");
if (!src.includes("__BUILD_ID__")) {
  console.warn(`[stamp-sw] __BUILD_ID__ not found in ${SW}; skipping`);
} else {
  writeFileSync(SW, src.replaceAll("__BUILD_ID__", buildId));
  console.log(`[stamp-sw] service worker cacheName = ${buildId}`);
}
