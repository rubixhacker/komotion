#!/bin/bash
# Read a Sandcastle lane's journal without the agent's own noise.
#
# The useful signal is the lane's own output, so this filters the echoed tool
# calls and prompt text once, here, rather than in every reader.
#
# Usage: scripts/ci/sandcastle-journal.sh <unit> [--follow] [--lines N]
#
# Examples:
#   scripts/ci/sandcastle-journal.sh com.rubixhacker.sandcastle.factory
#   scripts/ci/sandcastle-journal.sh com.rubixhacker.sandcastle.etl --follow
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <unit> [--follow] [--lines N]" >&2
  exit 2
fi

unit=$1
shift
follow=0
lines=200
while [ $# -gt 0 ]; do
  case "$1" in
    --follow) follow=1; shift ;;
    --lines) lines=$2; shift 2 ;;
    *) echo "usage: $0 <unit> [--follow] [--lines N]" >&2; exit 2 ;;
  esac
done

lane=${unit##*.}
log_dir="${HOME}/Workspace/komotion-factory/.sandcastle/logs"
out="${log_dir}/launchd-${lane}.log"
err="${log_dir}/launchd-${lane}.err.log"

# The launchd agents write stdout and stderr to these files. Read both so a
# lane's own progress and its errors appear together.
if [ "$follow" -eq 1 ]; then
  tail -f -n "$lines" "$out" "$err" 2>/dev/null
else
  tail -n "$lines" "$out" "$err" 2>/dev/null
fi |
  # The agent's echoed tool calls and the sandbox prompt text are noise to a
  # reader looking for the lane's own progress.
  grep -vE "opencode run --format json|--dangerously-skip-permissions" |
  grep -vE "^[[:space:]]+tail -f |^[[:space:]]+\)$|^[[:space:]]*$" || true
