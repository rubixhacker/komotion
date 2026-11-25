#!/bin/bash
# Install Sandcastle's macOS launchd agents from the repository templates.
#
# The repository templates and .sandcastle/lanes/manifest.json are the source
# of truth. This script writes one agent per manifest lane into
# ~/Library/LaunchAgents, taking each lane's interval, RunAtLoad and WatchPaths
# from the manifest. A null interval is an event-driven lane: no StartInterval
# key is rendered, so only its event marker or RunAtLoad can start it. It does
# not start the lanes unless --enable is given; --disable stops them when an
# operator needs to pause the Mac.
#
# Usage: install-sandcastle-macos.sh [--enable|--disable|--status]
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
template="$root/.sandcastle/launchd/com.rubixhacker.sandcastle.LANE.plist.template"
review_template="$root/.sandcastle/launchd/com.rubixhacker.sandcastle.review-server.plist.template"
runner_template="$root/.sandcastle/launchd/com.rubixhacker.sandcastle.dispatch-runner.plist.template"
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

manifest="$root/.sandcastle/lanes/manifest.json"
service_labels=(review-server dispatch-runner)
[ -f "$manifest" ] || { echo "missing $manifest" >&2; exit 1; }

label_for() { printf 'com.rubixhacker.sandcastle.%s' "$1"; }

# The lane definitions live in the manifest, not in parallel arrays here.
# Each line is the lane name, interval, RunAtLoad and an absolute WatchPath
# (empty when the lane has no event folder, or when the lane has no timer).
# The separator is not IFS whitespace, so an empty interval stays an empty field.
lane_config() {
  python3 - "$manifest" "$runtime" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    lanes = json.load(handle)["lanes"]
for lane in lanes:
    watch = lane.get("watchPath")
    interval = lane.get("interval")
    path = os.path.join(sys.argv[2], watch) if watch else ""
    print("|".join([
        lane["name"],
        "" if interval is None else str(interval),
        str(lane["runAtLoad"]).lower(),
        path,
    ]))
PY
}

lane_names() {
  python3 - "$manifest" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    for lane in json.load(handle)["lanes"]:
        print(lane["name"])
PY
}

if [ "$action" = status ]; then
  for lane in $(lane_names) "${service_labels[@]}"; do
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
  for lane in $(lane_names) "${service_labels[@]}"; do
    label=$(label_for "$lane")
    launchctl unload "$agents/$label.plist" >/dev/null 2>&1 || true
    echo "Stopped $label."
  done
  exit 0
fi

[ -f "$template" ] || { echo "missing $template" >&2; exit 1; }
heavy_state=${MACOS_HEAVY_WORK_STATE_DIR:-$HOME/.local/share/macos-heavy-work}
mkdir -p "$agents" "$runtime/.sandcastle/logs" "$heavy_state"

config=$(lane_config) || { echo "install-sandcastle-macos: cannot read $manifest" >&2; exit 1; }
while IFS='|' read -r lane interval run_at_load watch; do
  [ -n "$lane" ] || continue
  label=$(label_for "$lane")
  target="$agents/$label.plist"
  if [ -n "$watch" ]; then
    watch_xml=$(printf '  <key>WatchPaths</key>\n  <array>\n    <string>%s</string>\n  </array>' "$watch")
  else
    watch_xml=""
  fi
  if [ -n "$interval" ]; then
    interval_xml=$(printf '  <key>StartInterval</key>\n  <integer>%s</integer>' "$interval")
  else
    interval_xml=""
  fi
  HOME_DIR="$HOME" LANE="$lane" \
  RUNATLOAD="$run_at_load" WATCH_XML="$watch_xml" INTERVAL_XML="$interval_xml" TARGET="$target" \
  TEMPLATE="$template" HEAVY_STATE_DIR="$heavy_state" \
  HEAVY_GATE="${MACOS_HEAVY_WORK_GATE:-$HOME/.local/libexec/macos-heavy-work.mjs}" HEAVY_HELD="${MAC_HEAVY_WORK_HELD:-}" \
  HEAVY_WAIT="${SANDCASTLE_HEAVY_WORK_WAIT_SECONDS:-}" \
  HEAVY_TIMEOUT="${SANDCASTLE_HEAVY_WORK_TIMEOUT_SECONDS:-}" python3 - <<'PY'
import os
from pathlib import Path
from xml.sax.saxutils import escape

def plist_entry(key, value):
    return f'    <key>{escape(key)}</key>\n    <string>{escape(value)}</string>'

text = Path(os.environ["TEMPLATE"]).read_text()
text = text.replace("__HOME__", os.environ["HOME_DIR"])
text = text.replace("__LANE__", os.environ["LANE"])
text = text.replace("  __INTERVAL__", os.environ["INTERVAL_XML"])
text = text.replace("__RUNATLOAD__", os.environ["RUNATLOAD"])
text = text.replace("  __WATCHPATHS__", os.environ["WATCH_XML"])

heavy = [
    plist_entry("MACOS_HEAVY_WORK_STATE_DIR", os.environ["HEAVY_STATE_DIR"]),
    plist_entry("GIT_EDITOR", "true"),
    plist_entry("GIT_SEQUENCE_EDITOR", "true"),
    plist_entry("GIT_MERGE_AUTOEDIT", "no"),
    plist_entry("GIT_TERMINAL_PROMPT", "0"),
]
for env_key, plist_key in (
    ("HEAVY_GATE", "MACOS_HEAVY_WORK_GATE"),
    ("HEAVY_HELD", "MAC_HEAVY_WORK_HELD"),
    ("HEAVY_WAIT", "SANDCASTLE_HEAVY_WORK_WAIT_SECONDS"),
    ("HEAVY_TIMEOUT", "SANDCASTLE_HEAVY_WORK_TIMEOUT_SECONDS"),
):
    value = os.environ.get(env_key, "")
    if value:
        heavy.append(plist_entry(plist_key, value))
text = text.replace("  __HEAVY_ENV__", "\n".join(heavy))
Path(os.environ["TARGET"]).write_text(text)
PY
  plutil -lint "$target" >/dev/null || { echo "invalid plist $target" >&2; exit 1; }
  echo "Installed $target"
done <<< "$config"

review_env="$HOME/.config/komotion-review-server/production.env"
if [ -f "$review_env" ]; then
  target="$agents/$(label_for review-server).plist"
  # This Mac has no passwordless sudo to register Homebrew's JDK 21 with the
  # system's java_home, so fall back to the keg-only formula's path.
  java_home=$(/usr/libexec/java_home -v 21 2>/dev/null || echo "/opt/homebrew/opt/openjdk@21")
  [ -d "$java_home" ] || { echo "install-sandcastle-macos: no JDK 21 for the review server" >&2; exit 1; }
  HOME_DIR="$HOME" JAVA_HOME_DIR="$java_home" TARGET="$target" \
  TEMPLATE="$review_template" python3 - <<'PY'
import os
from pathlib import Path
text = Path(os.environ["TEMPLATE"]).read_text()
text = text.replace("__HOME__", os.environ["HOME_DIR"])
text = text.replace("__JAVA_HOME__", os.environ["JAVA_HOME_DIR"])
Path(os.environ["TARGET"]).write_text(text)
PY
  plutil -lint "$target" >/dev/null
  echo "Installed $target"
else
  echo "Review server not installed: $review_env is missing."
fi

runner_dir="$HOME/Workspace/actions-runner-sandcastle"
if [ -x "$runner_dir/run.sh" ]; then
  target="$agents/$(label_for dispatch-runner).plist"
  HOME_DIR="$HOME" TARGET="$target" TEMPLATE="$runner_template" python3 - <<'PY'
import os
from pathlib import Path
text = Path(os.environ["TEMPLATE"]).read_text().replace("__HOME__", os.environ["HOME_DIR"])
Path(os.environ["TARGET"]).write_text(text)
PY
  plutil -lint "$target" >/dev/null
  echo "Installed $target"
else
  echo "Dispatch runner not installed: $runner_dir/run.sh is missing."
fi

if [ "$action" = enable ]; then
  for lane in $(lane_names) "${service_labels[@]}"; do
    label=$(label_for "$lane")
    launchctl enable "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    launchctl unload "$agents/$label.plist" >/dev/null 2>&1 || true
    launchctl load "$agents/$label.plist"
    echo "Loaded $label."
  done
fi

echo "Runtime: $runtime"
echo "Use --status to check the agents, --enable to start them, --disable to stop them."
