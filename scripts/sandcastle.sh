#!/bin/bash
# Operate the Sandcastle factory: start, stop, status, fleet, retry, log, model, secrets, check.
#
# The Mac Studio runs each lane as a launchd agent. Stopping the factory unloads
# its agent and kills any lane process left behind: a Seatbelt exec normally
# dies with its own process group, but an operator stop must not leave one
# running.
#
# The agents run from the dedicated runtime checkout, so the status comes from
# there too, not from whatever tree this script is called in.
set -euo pipefail

runtime=${SANDCASTLE_RUNTIME:-$HOME/Workspace/komotion-factory}
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
label=com.rubixhacker.sandcastle.factory
agent="$HOME/Library/LaunchAgents/$label.plist"
uid=$(id -u)

if [ ! -d "$runtime/.sandcastle" ]; then
  echo "Sandcastle runtime not found at $runtime." >&2
  echo "Create it with: git worktree add $runtime origin/main" >&2
  exit 1
fi

# Process ids of live factory lane work: the entry point name is in argv.
factory_lane_pids() {
  pgrep -f "\.sandcastle/(drain|dependabot|etl|catalog-research|issue-triage)\.mts" 2>/dev/null || true
}

factory_loaded() {
  launchctl print "gui/$uid/$label" >/dev/null 2>&1
}

factory_status() {
  (cd "$runtime/.sandcastle" && npm run --silent status) || true
}

journal() {
  local unit_name=$1
  shift
  bash "$repo/scripts/ci/sandcastle-journal.sh" "$unit_name" "$@"
}

env_file=$runtime/.sandcastle/.env

# One setting's value from the runtime's .env, or nothing. Only the named line
# is read: the file also holds credentials.
setting() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

author_model() {
  local model
  model=$(setting SANDCASTLE_MODEL)
  echo "${model:-vllm/Qwen3.8}"
}

# The model a short name stands for: `local` is the host's own model server,
# `cloud` the first model the owner already listed for stalled tickets.
resolve_model() {
  local model
  case "$1" in
    local)
      model=$(setting SANDCASTLE_REVIEW_LOCAL_MODEL)
      echo "${model:-vllm/Qwen3.8}"
      ;;
    cloud)
      model=$(setting SANDCASTLE_STALL_FALLBACK_MODEL)
      model=${model%%,*}
      if [ -z "$model" ]; then
        echo "No cloud model is known: SANDCASTLE_STALL_FALLBACK_MODEL is not set in $env_file." >&2
        echo "Name one, for example: $0 model opencode-go/<model>" >&2
        return 1
      fi
      echo "$model"
      ;;
    vllm/?* | opencode-go/?* | ollama-cloud/?*)
      echo "$1"
      ;;
    *)
      echo "Unknown model '$1'. Use local, cloud, or a vllm/, opencode-go/ or ollama-cloud/ model." >&2
      return 1
      ;;
  esac
}

describe_model() {
  case "$1" in
    vllm/*)
      echo "author model: $1 (local model server; no sandbox holds a model credential)"
      ;;
    *)
      echo "author model: $1 (cloud)"
      echo "  Every issue-factory sandbox holds this provider's key while it is set."
      echo "  Review routes on the same model are skipped, so no ticket is reviewed by its author."
      echo "  The Dependabot lane's repairs fail under a cloud author: its sandbox gets no key."
      case "$1" in
        opencode-go/*)
          [ -s "$HOME/.config/sandcastle/opencode-go.key" ] ||
            echo "  WARNING: ~/.config/sandcastle/opencode-go.key is missing; a pass refuses to start without it."
          ;;
        ollama-cloud/*)
          [ -n "$(setting OLLAMA_API_KEY)" ] ||
            echo "  WARNING: OLLAMA_API_KEY is not set in $env_file; a pass refuses to start without it."
          ;;
      esac
      ;;
  esac
}

# Write SANDCASTLE_MODEL to the runtime's .env, replacing the line in place.
set_author_model() {
  local model=$1 scratch
  scratch=$(mktemp "$env_file.XXXXXX")
  chmod 600 "$scratch"
  if [ -f "$env_file" ] && grep -q '^SANDCASTLE_MODEL=' "$env_file"; then
    sed "s|^SANDCASTLE_MODEL=.*|SANDCASTLE_MODEL=$model|" "$env_file" >"$scratch"
  else
    [ -f "$env_file" ] && cat "$env_file" >"$scratch"
    echo "SANDCASTLE_MODEL=$model" >>"$scratch"
  fi
  mv "$scratch" "$env_file"
}

case "${1:-status}" in
  start)
    launchctl enable "gui/$uid/$label" >/dev/null 2>&1 || true
    launchctl load "$agent" 2>/dev/null || true
    launchctl kickstart -k "gui/$uid/$label"
    echo "Started; a GitHub event or the launchd interval runs the next pass."
    factory_status
    ;;
  stop)
    launchctl unload "$agent" >/dev/null 2>&1 || true
    for pid in $(factory_lane_pids); do
      kill "$pid" 2>/dev/null || true
    done
    echo "Stopped: label=$label loaded=$(factory_loaded && echo yes || echo no)"
    factory_status
    ;;
  status)
    echo "runtime: $runtime"
    echo "factory: $(factory_loaded && echo loaded || echo not-loaded)"
    echo "lane processes: $(factory_lane_pids | wc -l | tr -d ' ')"
    echo "author model: $(author_model) (next pass)"
    factory_status
    ;;
  fleet)
    # The whole fleet in one call: every agent's state, the factory pass with
    # its queue and in-flight tickets, the open pull requests with a check
    # summary, and the recent failures.
    (cd "$runtime/.sandcastle" && npm run --silent fleet)
    ;;
  retry)
    # A pass that keeps failing the same way waits before it runs again. Clear
    # that wait after fixing the cause, and start a pass now.
    rm -f -- "$runtime/.sandcastle/logs/failure-streaks.json"
    launchctl kickstart -k "gui/$uid/$label"
    echo "Cleared the failure backoff and started a pass."
    factory_status
    ;;
  log)
    # The lane's own output, without the agent's tool-call noise.
    shift || true
    journal "${1:-$label}" "${@:2}"
    ;;
  model)
    # Show the model that writes tickets, or switch it. A pass reads its
    # settings when it starts, so the pass in flight keeps the model it has.
    if [ $# -lt 2 ]; then
      describe_model "$(author_model)"
      echo "switch with: $0 model {local|cloud|<provider>/<model>}"
      exit 0
    fi
    wanted=$(resolve_model "$2")
    if [ "$wanted" = "$(author_model)" ]; then
      describe_model "$wanted"
      echo "Already set; nothing changed."
      exit 0
    fi
    set_author_model "$wanted"
    describe_model "$wanted"
    if factory_loaded; then
      echo "A pass is running on the previous model; the next pass uses the new one."
      echo "To switch now: $0 stop && $0 start (in-flight tickets keep their branches)."
    else
      echo "The next pass uses it."
    fi
    ;;
  secrets)
    # Prove no credential reached a sandbox: every secret variable must be
    # present and empty.
    bash "$repo/scripts/ci/sandcastle-secrets.sh"
    ;;
  check)
    # The runtime must be clean, on the pinned commit, and fully prepared.
    bash "$repo/scripts/ci/sandcastle-runtime.sh" --root "$runtime"
    ;;
  update)
    # Fast-forward the runtime to the merged code.
    git -C "$runtime" fetch origin main
    git -C "$runtime" merge --ff-only origin/main
    bash "$repo/scripts/ci/sandcastle-runtime.sh" --root "$runtime"
    ;;
  *)
    echo "usage: $0 {start|stop|status|fleet|retry|log [label]|model [local|cloud|<model>]|secrets|check|update}" >&2
    exit 2
    ;;
esac
