import type { NextConfig } from "next";

// Tauri sets TAURI_ENV_* for its beforeBuildCommand. When building inside Tauri
// we emit directory-style routes (…/index.html) so they resolve under Tauri's
// asset protocol; the web/GitHub Pages build keeps its existing clean URLs.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: isTauri,
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
