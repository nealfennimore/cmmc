#!/usr/bin/env bash
# Bump overlays/claude-code/manifest.json to the latest (or a given) release.
# Mirrors nixpkgs' own claude-code update.sh. Run on a machine with network
# access (the download hosts are not reachable from inside the sandbox), then
# `git diff manifest.json` and rebuild.
#
#   ./update.sh            # latest stable
#   ./update.sh 2.1.220    # a specific version
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BASE_URL="https://downloads.claude.ai/claude-code-releases"
VERSION="${1:-$(curl -fsSL "$BASE_URL/latest")}"

echo "Fetching manifest for claude-code $VERSION ..." >&2
curl -fsSL "$BASE_URL/$VERSION/manifest.json" --output manifest.json
echo "Updated manifest.json -> $VERSION" >&2
