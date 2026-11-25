#!/bin/bash
# Prepare the dedicated Sandcastle runtime checkout on the Mac Studio.
#
# The lanes never run from an interactive working tree: a dirty feature branch
# would execute uncommitted factory code with the host's credentials. This
# clones origin/main into ~/Workspace/komotion-factory, stages the
# gitignored build inputs from this checkout, and installs the lane's npm
# dependencies.
#
# Usage: setup-sandcastle-macos-runtime.sh [--source DIR]
set -euo pipefail

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
clone_source=git@github.com:rubixhacker/komotion.git
clone_ref=origin/main
while [ $# -gt 0 ]; do
  case "$1" in
    # Validate a migration before its branch is merged: clone the interactive
    # checkout's committed HEAD instead of GitHub's main.
    --source)
      source_root=$(CDPATH= cd -- "$2" && pwd)
      clone_source=$source_root
      clone_ref=$(git -C "$source_root" symbolic-ref --short HEAD 2>/dev/null || git -C "$source_root" rev-parse HEAD)
      shift 2
      ;;
    *) echo "setup-sandcastle-macos-runtime: unknown argument $1" >&2; exit 2 ;;
  esac
done

say() { printf 'setup-sandcastle-macos-runtime: %s\n' "$*" >&2; }

if [ ! -d "$runtime/.git" ]; then
  say "cloning $clone_source into $runtime"
  git -c protocol.file.allow=always clone --quiet "$clone_source" "$runtime"
fi

say "updating the runtime checkout to $clone_ref"
git -C "$runtime" fetch --quiet origin "$clone_ref" 2>/dev/null || true
if ! git -C "$runtime" checkout --quiet -B sandcastle-runtime "$clone_ref" 2>/dev/null; then
  git -C "$runtime" checkout --quiet -B sandcastle-runtime "$clone_ref"
fi

for input in local.properties .sandcastle/.env; do
  if [ -f "$source_root/$input" ]; then
    mkdir -p "$runtime/$(dirname -- "$input")"
    cp -p "$source_root/$input" "$runtime/$input"
    say "staged $input"
  else
    say "warning: $source_root/$input is missing"
  fi
done
chmod 600 "$runtime/.sandcastle/.env" 2>/dev/null || true

mkdir -p "$runtime/.sandcastle/logs" \
  "$runtime/.sandcastle/logs/factory-events" \
  "$runtime/.sandcastle/logs/dependabot-events" \
  "$runtime/.sandcastle/logs/triage-events" \
  "$HOME/.local/share/komotion-locks"

say "installing lane dependencies"
(cd "$runtime/.sandcastle" && npm ci --silent)

SANDCASTLE_RUNTIME_REF="$clone_ref" bash "$runtime/scripts/ci/sandcastle-runtime.sh"
say "runtime ready at $runtime"
