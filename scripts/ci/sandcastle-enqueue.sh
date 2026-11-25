#!/bin/bash
# Write a dispatch event into the factory host's lock/event directory.
#
# The GitHub dispatch workflows used to hard-code Bazzite's Node and checkout
# paths. This wrapper resolves them on each host so the same workflow runs on
# either the Bazzite dispatch runner or the Mac Studio's.
#
# Usage: sandcastle-enqueue.sh [factory|dependabot|triage]
set -euo pipefail

runtime=${SANDCASTLE_RUNTIME_DIR:-$HOME/Workspace/komotion-factory}
lane=${1:-dependabot}
cd "$runtime"
exec node .sandcastle/node_modules/tsx/dist/cli.mjs .sandcastle/enqueue.mts "$lane"
