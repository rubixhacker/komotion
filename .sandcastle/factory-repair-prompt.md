Repair the failing check on the factory branch for issue #{{ISSUE_NUMBER}} in rubixhacker/komotion.
Local branch: {{TICKET_BRANCH}}. Base at dispatch: {{BASE_SHA}}.

The host fetched the failure. Read it from `.sandcastle/{{FAILURE_CONTEXT_FILE}}` in this
worktree; this sandbox has no GitHub credential, so `gh` cannot authenticate here. If the log is
unavailable, the failure is infrastructure rather than source: report that as the blocker instead
of guessing.

Reproduce the failure locally before changing code. Distinguish a source bug from unavailable
runners, credentials, upstream services and flaky checks. When the evidence shows a flake or a
runner fault, change nothing and emit BLOCKED at once: the host re-runs the failed check once for a
repair that leaves the branch unchanged.

When the context is a conflict with main, the host has already moved the branch onto main and left
the conflicts in the files. Follow the file's steps and judge the result by the build and tests,
not by the markers being gone. Resolve both sides of each change; do not drop the branch's work.

Read AGENTS.md, `.sandcastle/CODING_STANDARDS.md` and the module you touch. Load the `factory-tools`
skill before your first build or search: it gives the command that replaces `./gradlew` here and
the commands denied in this sandbox.

Fix the underlying cause and add regression coverage where the failure exposes a missing case.
Do not weaken checks, edit baselines, disable rules, exclude affected code, relax thresholds or add
suppressions. If a finding genuinely cannot be fixed, stop and emit BLOCKED with the precise
blocker rather than bypassing it.

Run focused tests first, then `./gradlew desktopTest compileAllTargets` through
`.sandcastle/agent/bin/gradle`. The Gradle command does not repeat an unchanged build, so change
the code before you run it again.

Commit only the scoped source and tests on {{TICKET_BRANCH}}. Never push, mutate GitHub, merge or
close the issue: the host re-reviews the new head, re-runs the gate and pushes.

End with exactly one of:
<promise>COMPLETE</promise> — the fix is committed.
<promise>BLOCKED</promise> — the precise blocker is documented in the failure context file.
