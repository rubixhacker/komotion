#!/bin/bash
# Run one Sandcastle lane from the runtime checkout.
#
# launchd has no ExecStartPre, Restart=on-failure or SuccessExitStatus. This
# wrapper supplies all three for every lane: it verifies the checkout, runs
# the lane, treats the lane's "another run is active" (75) and operator stop
# (143) as clean, and reports a real fault.
#
# Usage: sandcastle-lane.sh factory|dependabot|triage
set -uo pipefail

lane=${1:-}
case "$lane" in
  factory|dependabot|triage) ;;
  *) echo "sandcastle-lane: unknown lane ${lane:-<none>}" >&2; exit 2 ;;
esac

# The launchd agent names follow the lane names, but the lane's entry point
# is the .mts file that implements it. Keep this mapping beside the launchd
# templates.
case "$lane" in
  factory) entry=main ;;
  triage) entry=triage ;;
  dependabot) entry=dependabot ;;
esac

root=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
cd "$root" || exit 1
bash scripts/ci/sandcastle-runtime.sh || exit 1

node .sandcastle/node_modules/tsx/dist/cli.mjs ".sandcastle/$entry.mts"
status=$?
case "$status" in
  0|75|143) exit 0 ;;
  *)
    echo "sandcastle-lane: $lane exited $status" >&2
    exit 1
    ;;
esac
