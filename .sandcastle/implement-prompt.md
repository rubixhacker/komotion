# TASK

Implement issue {{TASK_ID}}: {{ISSUE_TITLE}}

The host read the issue for you. Read the issue body, its labels and its
comments from `.sandcastle/{{ISSUE_CONTEXT_FILE}}` in this worktree. Use that
file instead of querying GitHub: this sandbox has no GitHub credential, and
any attempt to reach GitHub fails.

Work on branch {{BRANCH}}.

A pre-author advisory in the issue context names a late repair round that recurred in an earlier
pass. Check the prior verdict it names, and fix the cause it reports before you edit the branch. It is
advice, not a gate: the ticket still needs a source diagnosis before a check can fail.

Base check — do this before any source or issue exploration. Fetch `origin/main`
(`git fetch origin main`; when the network is unavailable, use the `origin/main` ref already in this
worktree) and compare `HEAD` with it (`git merge-base --is-ancestor HEAD origin/main`;
`git rev-list --left-right --count HEAD...origin/main` reports the gap). If the worktree is behind,
either rebase onto `origin/main`, or read the steering docs and lane inventory from that ref
(`git show origin/main:AGENTS.md` and `git show origin/main:.sandcastle/README.md`) before you
identify the system the ticket names. A stale checkout can describe the event-driven `factory` lane
as a polling-timer loop or send you looking for an unrelated ETL submission-triage system.
Rebase first so verification runs once against the final base instead of repeating after a late
rebase; follow-up issues that assume a prerequisite fix only in `origin/main` confirm it after
rebasing. The
reactive stale-branch guard is only the backstop, not this check.

Read AGENTS.md, README.md, relevant ADRs and the module you touch before you change it.

Load the `factory-tools` skill before anything else. It gives the commands this sandbox provides
(`.sandcastle/agent/bin/gradle`, `find-symbol`, `lib-source`) and the commands denied here,
`./gradlew` among them.

# REPOSITORY

This is Komotion, a frame-driven video animation library for Compose
Multiplatform: every animation is a pure function of the current frame number.
Read AGENTS.md for the build and test conventions, and read README.md and the
module you touch before you change it. The modules are
`komotion-core` (the core API), `komotion-player` (the embedded player),
`komotion-export-desktop` (MP4 export), `komotion-theme`, `komotion-algo-viz`
and `sample-app`.

# EXECUTION

Implement the smallest correct change that meets every acceptance criterion in
the issue. Never mark a criterion partial or out of scope on your own judgment.

Run every Gradle task through the wrapper: the changed test class first, then
its module, and `./gradlew desktopTest` once at the end.

# COMMIT

Make a git commit on {{BRANCH}}. The commit message must:

1. Summarize the change in one line
2. Reference the issue as `(#{{TASK_ID}})`
3. Name the key decisions and files changed

Keep it concise.

# FINAL RULES

Only work on this single task. Do not close the issue, do not open pull
requests, do not push; the host owns delivery.

Once complete, output <promise>COMPLETE</promise>.
