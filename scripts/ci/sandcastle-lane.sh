#!/bin/bash
# Run one Sandcastle lane from the dedicated runtime checkout (Mac Studio).
#
# launchd has no systemd's ExecStartPre, Restart=on-failure or
# SuccessExitStatus. This wrapper supplies all three for every lane:
# it verifies the checkout, runs the lane, treats the factory's "another run
# is active" (75) and operator stop (143) as clean, and alerts on a real fault.
#
# Usage: sandcastle-lane.sh <lane>
# The allowed lanes and their entry points come from
# .sandcastle/lanes/manifest.json, the same definition the installer reads.
set -uo pipefail

lane=${1:-}
root=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
manifest="$root/.sandcastle/lanes/manifest.json"

# The factory's launchd agent is named after the lane, but its entry point is
# drain.mts (the one-shot queue drainer). The manifest holds that mapping, so
# there is no allowlist or entry case to edit when a lane is added.
entry=$(python3 - "$manifest" "$lane" <<'PY' 2>/dev/null || true
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    lanes = json.load(handle)["lanes"]
for item in lanes:
    if item.get("name") == sys.argv[2]:
        print(item.get("entry", ""))
        break
PY
)
[ -n "$entry" ] || { echo "sandcastle-lane: unknown lane ${lane:-<none>}" >&2; exit 2; }

cd "$root" || exit 1
bash scripts/ci/sandcastle-runtime.sh || exit 1

node .sandcastle/node_modules/tsx/dist/cli.mjs ".sandcastle/$entry.mts"
status=$?
case "$status" in
  0|75|143) exit 0 ;;
  *)
    bash scripts/sandcastle-alert.sh --unit "sandcastle-$lane" "lane exited $status" || true
    exit 1
    ;;
esac
