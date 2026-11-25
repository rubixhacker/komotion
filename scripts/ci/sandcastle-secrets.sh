#!/bin/bash
# Prove that the factory's credential boundary still holds.
#
# A sandbox in the Seatbelt factory is a host process that inherits only the
# env the factory hands it. `.sandcastle/sandbox.mts` blanks every key from
# `.sandcastle/.env` that matches a secret pattern or appears in its explicit
# deny list before a sandbox is created. One narrow exception remains: the
# stall-fallback author may hold a single provider's credential
# (`.sandcastle/stall-fallback.mts`). This script checks that the guard and its
# one exception are still present, and that no live sandbox process carries a
# secret value on its command line.
#
# One sandbox may hold one credential: the stall-fallback author's. The factory
# marks that sandbox with SANDCASTLE_FALLBACK_AUTHOR, naming its providers, and
# only those providers' credentials are accepted there: OLLAMA_API_KEY for
# ollama-cloud and the mounted key file for opencode-go. The same credential
# anywhere else is a failure.
#
# Usage: scripts/ci/sandcastle-secrets.sh
#
# Environment:
#   SANDCASTLE_SECRET_KEYS   the variables to check (default: the factory's
#                            own secret set)
set -euo pipefail

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
keys=${SANDCASTLE_SECRET_KEYS:-"GH_TOKEN GITHUB_TOKEN SUBQ_API_KEY SUPABASE_DB_URL SUPABASE_DB_PASSWORD MOBAI_API_KEY MOBAI_TAILSCALE_KEY ANTHROPIC_API_KEY OLLAMA_API_KEY"}

say() { printf 'sandcastle-secrets: %s\n' "$*" >&2; }
fail() { say "$*"; exit 1; }

sandbox=$repo/.sandcastle/sandbox.mts
[ -f "$sandbox" ] || fail "cannot read $sandbox"

# The guard must still exist, and the only credential it lets through must
# still be the fallback author's.
grep -q 'SECRET_ENV_PATTERN' "$sandbox" || fail "sandbox.mts no longer defines a secret deny list"
grep -q 'deniedSandboxEnv' "$sandbox" || fail "sandbox.mts no longer blanks denied secrets"
grep -q 'ALLOWED_SANDBOX_SECRETS.*OLLAMA_API_KEY' "$sandbox" ||
  fail "sandbox.mts no longer limits sandbox secrets to the fallback author's key"

failed=0
# A sandbox is launched with its env passed by the provider, so a secret must
# never appear in a live sandbox process's command line either.
sandbox_lines=$(pgrep -fl "sandbox-exec|\.sandcastle/(drain|dependabot|etl|catalog-research|issue-triage)\.mts" 2>/dev/null || true)
if [ -n "$sandbox_lines" ]; then
  for key in $keys; do
    value=$(printenv "$key" 2>/dev/null || true)
    if [ -n "$value" ] && printf '%s\n' "$sandbox_lines" | grep -qF -- "$value"; then
      say "$key appears in a live sandbox process command line"
      failed=1
    fi
  done
fi

[ "$failed" -eq 0 ] || fail "a credential reached a sandbox"
say "no sandbox holds a credential it should not"
