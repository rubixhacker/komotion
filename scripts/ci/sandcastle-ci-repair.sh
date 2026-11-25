#!/bin/bash
# Run the factory's reusable CI repair on the dispatch host.
#
# A workflow_run that completed with a failing conclusion names the factory
# branch that went red; a push to main can leave any factory pull request
# conflicting, so all of them are checked. The script re-reads GitHub itself:
# the event only says which pull request to look at, never what is wrong with it.
#
# Usage: sandcastle-ci-repair.sh [workflow_run|push] [head_branch]
set -euo pipefail

runtime=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
event=${1:-}
branch=${2:-}
cd "$runtime"

if [[ "$event" == "workflow_run" && -n "$branch" ]]; then
  exec npm --prefix .sandcastle run ci-repair -- --branch "$branch"
fi
exec npm --prefix .sandcastle run ci-repair -- --all
