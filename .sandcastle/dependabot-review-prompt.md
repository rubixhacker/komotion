Independently review the repair to Dependabot PR #{{PR_NUMBER}}.
This is a read-only host review: no shell, `gh`, edits, subagents, builds or web access. Use only
read-only file tools. Read repository/platform guidance, .sandcastle/CODING_STANDARDS.md,
.sandcastle/logs/dependabot-context.json, .sandcastle/logs/original-update.diff,
.sandcastle/logs/changes-since-original.diff, .sandcastle/logs/repair-evidence.md and actual
failing logs. Read `.sandcastle/review.diff`, supplied by the host from
`git diff {{BASE_SHA}}...HEAD`, and surrounding source at the exact head. Ensure the original
intended dependency update is retained, fixes are scoped, conflicts preserve both intents,
regression coverage can fail, and no check/suppression/baseline/severity has been weakened.
Verify privacy, security and platform compatibility. Do not edit files, commit, push or mutate GitHub.

Source/local review can pass before remote CI runs; clearly distinguish available local evidence
from pending remote/native checks. The host must await those checks before merging. A missing local
required gate, unresolved code issue, unsupported runtime claim, or reverted update blocks approval.
Emit <review>PASS</review> only for the unchanged committed head with no blockers; otherwise
<review>FAIL</review> with concrete file/line findings for the author to correct.
