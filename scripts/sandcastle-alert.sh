#!/bin/bash
# Tell a human that the Sandcastle factory needs them.
#
# Usage: scripts/sandcastle-alert.sh [--unit UNIT] MESSAGE...
#
# On the Mac Studio the six launchd agents report their own failures, and the
# factory calls this script directly, without --unit, for things only a human
# can resolve. --unit remains accepted for callers that name a lane.
#
# An alert writes the alert log, shows a desktop notification when a session is
# attached, and prints the status line the operator would run by hand. The same
# alert is written once per repeat window: a failure that recurs every thirty
# seconds for five hours is one entry with a count, not six hundred.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
log="$root/.sandcastle/logs/factory-alerts.log"
state_dir="$root/.sandcastle/logs/alert-state"
logs_tool="$root/.sandcastle/logs.mts"
repeat_minutes=${SANDCASTLE_ALERT_REPEAT_MINUTES:-360}
log_max_bytes=${SANDCASTLE_ALERT_LOG_MAX_BYTES:-262144}

unit=""
if [ "${1:-}" = "--unit" ]; then
  unit=${2:?--unit needs a unit name}
  shift 2
fi
# Older launchd agents call this without --unit; MONITOR_UNIT is the fallback
# name when a caller supplies one.
[ -n "$unit" ] || unit=${MONITOR_UNIT:-}

text="$*"
if [ -n "$unit" ]; then
  subject=$unit
  title="Sandcastle: $unit failed"
else
  subject=factory
  title="Sandcastle needs a human"
fi

mkdir -p "$(dirname -- "$log")" "$state_dir"
# Old state is only history; the directory must not grow without bound.
find "$state_dir" -type f -mtime +7 -delete 2>/dev/null || true

if command -v sha1sum >/dev/null 2>&1; then
  key=$(printf '%s\n%s' "$subject" "$text" | sha1sum | cut -d' ' -f1)
else
  key=$(printf '%s\n%s' "$subject" "$text" | shasum -a 1 | cut -d' ' -f1)
fi
state="$state_dir/$key"
now=$(date +%s)
# GNU date has -Is/-d; BSD date (Mac Studio) has -r. Keep one ISO-8601 format
# on both so the alert log and the tests read the same timestamps.
iso_date() { date -u +%Y-%m-%dT%H:%M:%S%z "$@"; }
iso_from_epoch() {
  if iso_date -r "$1" >/dev/null 2>&1; then iso_date -r "$1"; else iso_date -d "@$1"; fi
}

suppressed=0
first=$now
if [ -f "$state" ]; then
  read -r suppressed first last_logged <"$state" || true
  case "$suppressed$first${last_logged:-x}" in
    *[!0-9]*) suppressed=0; first=$now; last_logged=0 ;;
  esac
  if [ $((now - last_logged)) -lt $((repeat_minutes * 60)) ]; then
    suppressed=$((suppressed + 1))
    printf '%s %s %s\n' "$suppressed" "$first" "$last_logged" >"$state"
    printf 'alert repeated (%s since the last entry in %s): %s %s\n' \
      "$suppressed" "$log" "$subject" "$text"
    exit 0
  fi
fi

# `npm run status` exits non-zero for a failed or stale pass, which is the
# expected case here.
message=$(cd "$root/.sandcastle" && npm run --silent status 2>&1 || true)

{
  printf '%s %s %s\n' "$(iso_date)" "$subject" "$text"
  if [ "$suppressed" -gt 0 ]; then
    printf 'repeated %s more time(s) since %s without a new entry\n' \
      "$suppressed" "$(iso_from_epoch "$first")"
  fi
  printf '%s\n' "$message"
} >>"$log"
printf '0 %s %s\n' "$first" "$now" >"$state"

# The alert log is diagnostic state: keep the newest bytes so a host that
# faults for weeks cannot fill its disk.
if [[ "$log_max_bytes" =~ ^[0-9]+$ ]] && [ -f "$logs_tool" ] 2>/dev/null; then
  node --experimental-strip-types "$logs_tool" cap-file --path "$log" --max-bytes "$log_max_bytes" >/dev/null 2>&1 || true
elif [ -f "$log" ]; then
  tail -c "$log_max_bytes" "$log" >"$log.tmp" && mv "$log.tmp" "$log"
fi

if command -v osascript >/dev/null 2>&1; then
  # Best effort: a notification must never block the lane or change its status.
  osascript -e 'on run argv' \
    -e 'display alert "Sandcastle needs a human" message (item 1 of argv)' \
    -e 'end run' "$title: $text" >/dev/null 2>&1 &
  alert_pid=$!
  ( sleep 5; kill -9 "$alert_pid" 2>/dev/null || true ) >/dev/null 2>&1 &
  watchdog_pid=$!
  wait "$alert_pid" 2>/dev/null || true
  kill "$watchdog_pid" 2>/dev/null || true
fi

if command -v notify-send >/dev/null 2>&1 && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  # The alert log and stdout already carry the message; a desktop session
  # without a notification daemon must not turn this into a failure.
  notify-send --urgency=critical "$title" "$text
$message" 2>/dev/null || true
fi

printf '%s %s\n%s\n' "$subject" "$text" "$message"
