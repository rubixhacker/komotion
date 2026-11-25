#!/bin/bash
# Run one Sandcastle lane from the dedicated runtime checkout (Mac Studio).
#
# launchd has no systemd's ExecStartPre, Restart=on-failure or
# SuccessExitStatus. This wrapper supplies all three for every lane:
# it caps the open logs, consumes the exact event snapshot before preflight
# and locking, verifies the checkout, runs the lane, treats 75 and 143 as
# clean, and alerts on a real fault without changing its exit status.
#
# A marker that arrives after the snapshot is never acknowledged by this
# pass. A wrapper that hits the lock requeues its snapshot so the marker
# survives until a pass can actually consume it.
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

logs="$root/.sandcastle/logs"
mkdir -p "$logs"
pending="$logs/$lane.pending.$$.json"
events_dir="$logs/$lane-events"
events_tool="$root/.sandcastle/events-cli.mts"
logs_tool="$root/.sandcastle/logs.mts"
alert="$root/scripts/sandcastle-alert.sh"

cap_logs() {
  if [[ -f "$logs_tool" ]]; then
    node --experimental-strip-types "$logs_tool" cap --root "$root" --lane "$lane" >/dev/null 2>&1 || true
  fi
}
requeue_events() {
  if [[ -f "$pending" && -f "$events_tool" ]]; then
    node --experimental-strip-types "$events_tool" requeue --directory "$events_dir" --snapshot "$pending" >/dev/null 2>&1 || true
  fi
}
report_fault() {
  local status=$1
  local detail=$2
  if (( status != 0 )) && [[ -f "$alert" ]]; then
    bash "$alert" --unit "sandcastle-$lane" "$detail" >/dev/null 2>&1 || true
  fi
}

cap_logs
trap 'cap_logs; rm -f "$pending"' EXIT

# Consume before preflight and locking: the marker that woke this wrapper is
# serviced by this invocation even when preflight changes the checkout.
if [[ -f "$events_tool" ]]; then
  node --experimental-strip-types "$events_tool" expire --directory "$events_dir" >/dev/null 2>&1 || true
  node --experimental-strip-types "$events_tool" snapshot --directory "$events_dir" --snapshot "$pending"
  status=$?
  if (( status != 0 )); then
    report_fault "$status" "event snapshot failed with status $status"
    exit "$status"
  fi
  node --experimental-strip-types "$events_tool" ack --directory "$events_dir" --snapshot "$pending" >/dev/null
  status=$?
  if (( status != 0 )); then
    requeue_events
    report_fault "$status" "event acknowledgement failed with status $status"
    exit "$status"
  fi
fi

bash scripts/ci/sandcastle-runtime.sh
status=$?
if (( status != 0 )); then
  # No pass ran, so its wake-up event must remain pending.
  requeue_events
  report_fault "$status" "runtime preflight exited $status"
  exit "$status"
fi

node .sandcastle/node_modules/tsx/dist/cli.mjs ".sandcastle/$entry.mts"
status=$?
case "$status" in
  0|143) exit 0 ;;
  75)
    # Another pass holds the lock. Preserve the trigger for that pass's end.
    requeue_events
    exit 0
    ;;
  *)
    report_fault "$status" "lane exited $status"
    exit "$status"
    ;;
esac
