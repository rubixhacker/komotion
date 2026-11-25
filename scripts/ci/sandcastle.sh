#!/bin/bash
# Type-check, lint and test the Sandcastle factory scripts.
#
# node_modules is reinstalled with `npm ci` whenever package-lock.json changes, keyed on the lock's
# Git blob hash, so a persistent runner never tests against dependencies an older lock installed
# (the stale-ignored-file class of ca4343891). Under CI=true a missing npm fails the check; only a
# local machine without Node skips it.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root/.sandcastle"

if ! command -v npm >/dev/null 2>&1; then
  if [ "${CI:-}" = true ]; then
    echo "verifySandcastle: npm is not on PATH; CI must type-check and test .sandcastle" >&2
    exit 1
  fi
  echo "verifySandcastle: skipped; npm is not on PATH. Install Node, then rerun."
  exit 0
fi

stamp=node_modules/.caff-package-lock-hash
lock_hash=$(git hash-object package-lock.json)
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$lock_hash" ]; then
  npm ci --no-audit --no-fund
  printf '%s\n' "$lock_hash" > "$stamp"
fi

npm run --silent typecheck
npm run --silent lint
npm run --silent check:flake
npm run --silent lanes:check
npm test --silent
