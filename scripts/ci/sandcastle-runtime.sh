#!/bin/bash
# Verify the Sandcastle runtime checkout before a lane runs from it.
#
# The factory's launchd agents execute whatever is checked out in the runtime
# directory, so a stale or half-prepared checkout runs the wrong code with the
# host's credentials. This asserts the things a pass depends on:
#
#   1. the checkout is clean, so no uncommitted factory code can run;
#   2. it runs the merged code, which it fast-forwards to when it lags;
#   3. the gitignored build input the quality gate reads is present;
#   4. the main branch ruleset still requires the repository's checks, so a
#      green pull request is one that was actually verified.
#
# Usage: scripts/ci/sandcastle-runtime.sh [--root DIR] [--ref REF] [--allow-dirty]
#
# Environment:
#   SANDCASTLE_RUNTIME_DIR   the runtime checkout (default: the one beside
#                            this repository, ~/Workspace/komotion-factory;
#                            when this script runs from that runtime, the runtime
#                            is the checkout it runs from)
#   SANDCASTLE_RUNTIME_REF   the commit the runtime must run (default: origin/main)
#   SANDCASTLE_REPO          the repository whose ruleset is checked
#   SANDCASTLE_SKIP_RULESET_CHECK  set to true to skip the ruleset check
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
runtime=${SANDCASTLE_RUNTIME_DIR:-}
# The runtime runs the merged code. The comparison is by commit, not by branch
# name: the runtime keeps its own branch so the interactive checkout can hold
# main, and a detached checkout is still fine.
ref=${SANDCASTLE_RUNTIME_REF:-origin/main}
allow_dirty=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root) runtime=$2; shift 2 ;;
    --ref) ref=$2; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    *) echo "sandcastle-runtime: unknown argument $1" >&2; exit 2 ;;
  esac
done

if [ -z "$runtime" ]; then
  base=$(basename -- "$root")
  if [ "${SANDCASTLE_DEDICATED_RUNTIME:-}" = "1" ] || [ "$base" != "${base%-factory}" ]; then
    # The systemd units run this script from the runtime itself, and a checkout whose name
    # already ends in "-factory" is that runtime rather than the interactive checkout beside
    # it. Deriving the sibling from either produced "<runtime>-factory", which does not
    # exist, so every lane refused to start.
    runtime=$root
  else
    runtime=$(CDPATH= cd -- "$root/.." && pwd)/$base-factory
  fi
fi

say() { printf 'sandcastle-runtime: %s\n' "$*" >&2; }
fail() { say "$*"; exit 1; }

[ -d "$runtime" ] || fail "the runtime checkout $runtime does not exist"
git -C "$runtime" rev-parse --git-dir >/dev/null 2>&1 ||
  fail "$runtime is not a git checkout"

# 1. A dirty checkout runs uncommitted factory code.
dirty=$(git -C "$runtime" status --porcelain)
if [ -n "$dirty" ] && [ "$allow_dirty" -eq 0 ]; then
  say "the runtime checkout has uncommitted changes:"
  printf '%s\n' "$dirty" | sed 's/^/  /' >&2
  fail "commit or discard them; the factory executes this checkout"
fi

# 2. The checkout runs the code the factory is pinned to. A runtime that only
# lags the merged main is fast-forwarded: it exists to run that code, and
# stopping every lane after each merge would need a human at the right moment.
git -C "$runtime" fetch --quiet origin main 2>/dev/null || true
actual=$(git -C "$runtime" rev-parse HEAD)
expected=$(git -C "$runtime" rev-parse "$ref" 2>/dev/null || echo "")
if [ -z "$expected" ]; then
  fail "the runtime checkout cannot resolve $ref; fetch it first"
fi
if [ "$actual" != "$expected" ]; then
  if git -C "$runtime" merge-base --is-ancestor "$actual" "$expected" 2>/dev/null; then
    say "the runtime lags $ref; fast-forwarding it"
    git -C "$runtime" merge --ff-only "$expected" >/dev/null ||
      fail "the runtime could not be fast-forwarded to $ref"
  else
    fail "the runtime checkout is at ${actual:0:7}, which $ref does not contain; a human must reconcile it"
  fi
fi

# 3. The gitignored build input the quality gate reads. AGP needs sdk.dir from
# local.properties unless the host supplies ANDROID_HOME directly.
if [ -z "${ANDROID_HOME:-}" ] && [ ! -f "$runtime/local.properties" ]; then
  say "missing local.properties (sdk.dir); set ANDROID_HOME or stage it with:"
  say "  (cd $runtime && bash scripts/ci/prepare-local-inputs.sh)"
  exit 1
fi

# The factory's own env file and dependencies.
[ -f "$runtime/.sandcastle/.env" ] || fail "missing .sandcastle/.env"
[ -d "$runtime/.sandcastle/node_modules" ] ||
  fail "missing .sandcastle/node_modules; run: (cd $runtime && npm ci --prefix .sandcastle)"

# The env file holds credentials: it must not be readable by other accounts.
if mode=$(stat -c '%a' "$runtime/.sandcastle/.env" 2>/dev/null); then
  : # GNU stat (Bazzite)
else
  mode=$(stat -f '%Lp' "$runtime/.sandcastle/.env") # BSD stat (Mac Studio)
fi
if [ "$mode" != "600" ]; then
  fail ".sandcastle/.env is mode $mode, not 600; it holds the host's credentials"
fi

# 4. The merge gate. The Dependabot watchdog waits for a human approval before it
# merges a dependency bump, while the factory's own pull requests are armed by a
# human and merge once the checks pass. The ruleset lives on GitHub, where
# nothing in the tree notices when it changes, and reading it needs
# administration scope that a workflow's own token does not have. The host's
# `gh` has the scope, so the host checks it before any lane runs.
check_main_ruleset() {
  local repo=${SANDCASTLE_REPO:-rubixhacker/komotion}
  local id covers contexts missing
  id=$(gh api "repos/$repo/rulesets" --jq \
    '.[] | select(.enforcement=="active" and .target=="branch") | .id' 2>/dev/null | head -1)
  if [ -z "$id" ]; then
    say "the main branch ruleset could not be read; skipping the merge-gate check"
    return 0
  fi
  covers=$(gh api "repos/$repo/rulesets/$id" --jq '.conditions.ref_name.include // [] | join(",")' 2>/dev/null)
  case ",$covers," in
    *,~DEFAULT_BRANCH,*) ;;
    *)
      say "the active branch ruleset does not cover the default branch; skipping"
      return 0
      ;;
  esac
  contexts=$(gh api "repos/$repo/rulesets/$id" --jq \
    '[.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context] | join("|")' 2>/dev/null)
  # The required checks are what make a green pull request safe to merge. A
  # ruleset that drops one lets an unverified change land, so the host holds
  # that line even though the review requirement is the owner's to set.
  missing=""
  for check in "Run tests and compile all targets"; do
    case "$contexts" in
      *"$check"*) ;;
      *) missing="$missing $check" ;;
    esac
  done
  if [ -n "$missing" ]; then
    fail "the main branch ruleset no longer requires:$missing"
  fi
  say "the main branch ruleset requires the repository's checks"
}

if [ "${SANDCASTLE_SKIP_RULESET_CHECK:-}" != "true" ] && command -v gh >/dev/null 2>&1; then
  check_main_ruleset
fi

say "runtime $runtime is clean, at $ref, and fully prepared"
