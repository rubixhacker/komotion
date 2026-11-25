Repair Dependabot PR #{{PR_NUMBER}} in rubixhacker/komotion.
Local repair branch: {{REPAIR_BRANCH}}. Original PR head: {{ORIGINAL_HEAD}}.
Latest main base at dispatch: {{BASE_SHA}}.

Read CLAUDE.md, relevant nested guidance, CONTEXT.md and .sandcastle/CODING_STANDARDS.md.
You own dependency compatibility, scope, regression review and final verification.
Read .sandcastle/logs/dependabot-context.json, original-update.diff, CI logs and review.txt if present.
You share the codebase with other workers; preserve their changes. Own only this dependency update,
its compatibility fixes, and conflicts with current main. Preserve the intended dependency version;
never revert/downgrade the update, weaken checks, hide findings, edit baselines, or add suppressions.

Inspect and reproduce the actual failing check, distinguishing source bugs from unavailable runners,
credentials and upstream services. If the original PR head lacks {{BASE_SHA}}, rebase the LOCAL repair
branch onto that exact base and resolve conflicts by reading both sides. Do not force-push yourself.
Fix the underlying cause, add meaningful regression coverage, and run focused checks and qualityGate.
Run one Gradle build at a time in the foreground with --no-daemon. Never background builds or
poll for the presence of GradleDaemon: an idle daemon does not mean a build is still running.
If a build stalls, inspect its active task/process and record a concrete BLOCKED diagnosis rather
than repeatedly starting builds or sleeping. Distinguish stalled infrastructure from slow progress.
If the required fix already exists on current origin/main, emit BLOCKED with that commit; the
controller will rebase the original PR rather than publish a duplicate fix.
For native failures, record real CI/native evidence; compilation is not device proof. If blocked by
unavailable infrastructure or a genuinely incompatible update, explain the blocker in local notes.

Write .sandcastle/logs/repair-evidence.md with cause, preserved update, commands/outcomes and limitations.
Commit only the scoped source and tests on {{REPAIR_BRANCH}}. If review.txt contains blockers, fix them
and rerun validation before returning. Do not mutate GitHub, merge, deploy, release or close issues.
Only the host pushes reviewed fixes and merges after all applicable exact-head CI gates pass.

Emit <promise>COMPLETE</promise> when the repair is committed and locally verified, otherwise
<promise>BLOCKED</promise> with the precise blocker.
