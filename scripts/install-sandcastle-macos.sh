#!/bin/bash
# Install Sandcastle's macOS launchd agents from the repository templates.
#
# The repository templates are the source of truth. This script writes one
# agent per lane into ~/Library/LaunchAgents. It does not start the lanes
# unless --enable is given; --disable stops them when an operator needs to
# pause the Mac.
#
# Usage: install-sandcastle-macos.sh [--enable|--disable|--status]
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
template="$root/.sandcastle/launchd/com.rubixhacker.sandcastle.LANE.plist.template"
agents="$HOME/Library/LaunchAgents"
runtime=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
action=install

while [ $# -gt 0 ]; do
  case "$1" in
    --enable) action=enable; shift ;;
    --disable) action=disable; shift ;;
    --status) action=status; shift ;;
    *) echo "install-sandcastle-macos: unknown argument $1" >&2; exit 2 ;;
  esac
done

# Lanes, their timers, and the event directory each one watches. The triage
# lane is the owner's hourly pass; it has no event directory because nothing
# dispatches it from GitHub.
labels=(factory dependabot triage)
intervals=(300 1800 3600)
run_at_load=(true true false)
watch_dirs=(
  "$runtime/.sandcastle/logs/factory-events"
  "$runtime/.sandcastle/logs/dependabot-events"
  ""
)

label_for() { printf 'com.rubixhacker.sandcastle.%s' "$1"; }

if [ "$action" = status ]; then
  for lane in "${labels[@]}"; do
    label=$(label_for "$lane")
    if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
      echo "$label: loaded"
    else
      echo "$label: not loaded"
    fi
  done
  exit 0
fi

if [ "$action" = disable ]; then
  for lane in "${labels[@]}"; do
    label=$(label_for "$lane")
    launchctl unload "$agents/$label.plist" >/dev/null 2>&1 || true
    echo "Stopped $label."
  done
  exit 0
fi

[ -f "$template" ] || { echo "missing $template" >&2; exit 1; }
mkdir -p "$agents" "$runtime/.sandcastle/logs"

for i in "${!labels[@]}"; do
  lane=${labels[$i]}
  label=$(label_for "$lane")
  target="$agents/$label.plist"
  if [ -n "${watch_dirs[$i]}" ]; then
    watch=$(printf '  <key>WatchPaths</key>\n  <array>\n    <string>%s</string>\n  </array>' "${watch_dirs[$i]}")
  else
    watch=""
  fi
  HOME_DIR="$HOME" LANE="$lane" INTERVAL="${intervals[$i]}" \
  RUNATLOAD="${run_at_load[$i]}" WATCH_XML="$watch" TARGET="$target" \
  TEMPLATE="$template" python3 - <<'PY'
import os
from pathlib import Path
text = Path(os.environ["TEMPLATE"]).read_text()
text = text.replace("__HOME__", os.environ["HOME_DIR"])
text = text.replace("__LANE__", os.environ["LANE"])
text = text.replace("__INTERVAL__", os.environ["INTERVAL"])
text = text.replace("__RUNATLOAD__", os.environ["RUNATLOAD"])
text = text.replace("  __WATCHPATHS__", os.environ["WATCH_XML"])
Path(os.environ["TARGET"]).write_text(text)
PY
  plutil -lint "$target" >/dev/null || { echo "invalid plist $target" >&2; exit 1; }
  echo "Installed $target"
done

if [ "$action" = enable ]; then
  for lane in "${labels[@]}"; do
    label=$(label_for "$lane")
    launchctl enable "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    launchctl unload "$agents/$label.plist" >/dev/null 2>&1 || true
    launchctl load "$agents/$label.plist"
    echo "Loaded $label."
  done
fi

echo "Runtime: $runtime"
echo "Use --status to check the agents, --enable to start them, --disable to stop them."
