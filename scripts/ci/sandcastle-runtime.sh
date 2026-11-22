#!/bin/bash
# Verify the Sandcastle runtime checkout before a lane runs from it.
#
# The launchd agents execute whatever is checked out in the runtime
# directory, so a stale or half-prepared checkout runs the wrong code with
# the host's credentials. This asserts the things a pass depends on:
#
#   1. the checkout is clean, so no uncommitted factory code can run;
#   2. it runs the merged code, which it fast-forwards to when it lags;
#   3. the factory's env file and dependencies are present;
#   4. the env file holds credentials and is not readable by other accounts.
#
# Usage: scripts/ci/sandcastle-runtime.sh [--root DIR] [--ref REF] [--allow-dirty]
set -euo pipefail

root=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
ref=${SANDCASTLE_RUNTIME_REF:-origin/main}
allow_dirty=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root) root=$2; shift 2 ;;
    --ref) ref=$2; shift 2 ;;
    --allow-dirty) allow_dirty=1 ;;
    *) echo "sandcastle-runtime: unknown argument $1" >&2; exit 2 ;;
  esac
done

say() { printf 'sandcastle-runtime: %s\n' "$*" >&2; }
fail() { say "$*"; exit 1; }

[ -d "$root" ] || fail "the runtime checkout $root does not exist"
git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || fail "$root is not a git checkout"

# 1. A dirty checkout runs uncommitted factory code.
dirty=$(git -C "$root" status --porcelain)
if [ -n "$dirty" ] && [ "$allow_dirty" -eq 0 ]; then
  say "the runtime checkout has uncommitted changes:"
  printf '%s\n' "$dirty" | sed 's/^/  /' >&2
  fail "commit or discard them; the factory executes this checkout"
fi

# 2. The checkout runs the code the factory is pinned to. A runtime that only
# lags the merged main is fast-forwarded: it exists to run that code, and
# stopping every lane after each merge would need a human at the right moment.
git -C "$root" fetch --quiet origin main 2>/dev/null || true
actual=$(git -C "$root" rev-parse HEAD)
expected=$(git -C "$root" rev-parse "$ref" 2>/dev/null || echo "")
if [ -z "$expected" ]; then
  fail "the runtime checkout cannot resolve $ref; fetch it first"
fi
if [ "$actual" != "$expected" ]; then
  if git -C "$root" merge-base --is-ancestor "$actual" "$expected" 2>/dev/null; then
    say "the runtime lags $ref; fast-forwarding it"
    git -C "$root" merge --ff-only "$expected" >/dev/null ||
      fail "the runtime could not be fast-forwarded to $ref"
  else
    fail "the runtime checkout is at ${actual:0:7}, which $ref does not contain; a human must reconcile it"
  fi
fi

# 3. The factory's own env file and dependencies.
[ -f "$root/.sandcastle/.env" ] || fail "missing .sandcastle/.env"
[ -d "$root/.sandcastle/node_modules" ] ||
  fail "missing .sandcastle/node_modules; run: (cd $root && npm install --prefix .sandcastle)"

# 4. The env file holds credentials: it must not be readable by other accounts.
if mode=$(stat -f '%Lp' "$root/.sandcastle/.env" 2>/dev/null); then
  : # BSD stat (macOS)
else
  mode=$(stat -c '%a' "$root/.sandcastle/.env")
fi
if [ "$mode" != "600" ]; then
  fail ".sandcastle/.env is mode $mode, not 600; it holds the host's credentials"
fi

say "runtime $root is clean, at $ref, and fully prepared"
