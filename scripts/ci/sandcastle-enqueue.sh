#!/bin/bash
# Write a dispatch event into the factory host's event directory.
#
# The GitHub dispatch workflows call this on the self-hosted dispatch runner.
# It drops a marker file into the lane's event directory; the lane's launchd
# agent watches that directory (WatchPaths) and wakes immediately instead of
# waiting for its next timer tick. The lane's timer and the dispatch workflow
# are both triggers; the marker only removes the wait.
#
# Usage: sandcastle-enqueue.sh [factory|dependabot|triage]
set -euo pipefail

runtime=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
lane=${1:-factory}
case "$lane" in
  factory|dependabot|triage) ;;
  *) echo "sandcastle-enqueue: unknown lane ${lane}" >&2; exit 2 ;;
esac

cd "$runtime" || exit 1
mkdir -p ".sandcastle/logs/${lane}-events"
marker=".sandcastle/logs/${lane}-events/$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
printf 'lane=%s\nat=%s\n' "$lane" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
echo "queued $lane event $marker"
