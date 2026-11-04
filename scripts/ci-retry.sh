#!/usr/bin/env bash
# Run a command and retry it after transient failures.
#
# CI uses this for Nix substitution. cache.nixos.org sometimes drops all
# connections at once. Nix then resumes a NAR download from an offset, the
# CDN answers HTTP 416, and Nix does not retry that error. Paths that already
# downloaded stay in the store, so a second run fetches only the missing paths.
#
# Usage: scripts/ci-retry.sh <command> [args...]
# Environment: CI_RETRY_ATTEMPTS (default 3), CI_RETRY_DELAY seconds (default 20).
set -uo pipefail

attempts="${CI_RETRY_ATTEMPTS:-3}"
delay="${CI_RETRY_DELAY:-20}"

for ((i = 1; i <= attempts; i++)); do
  "$@" && exit 0
  status=$?
  if ((i == attempts)); then
    echo "::error::Command failed after $attempts attempts (exit $status): $*"
    exit "$status"
  fi
  echo "::warning::Command failed (attempt $i/$attempts, exit $status). Retry in $((delay * i))s: $*"
  sleep $((delay * i))
done
