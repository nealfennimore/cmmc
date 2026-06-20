import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Tauri sets TAURI_ENV_* for its beforeBuildCommand. When building inside Tauri
// we emit directory-style routes (…/index.html) so they resolve under Tauri's
// asset protocol; the web/GitHub Pages build keeps its existing clean URLs.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

// Short commit the build was cut from, shown in the footer for support/debugging.
function resolveGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Building outside a git checkout (e.g. a source tarball); CI sets GITHUB_SHA.
    return process.env.GITHUB_SHA?.slice(0, 8) ?? "dev";
  }
}

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: isTauri,
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_SHA: resolveGitSha(),
  },
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
