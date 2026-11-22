# TASK

Implement issue {{TASK_ID}}: {{ISSUE_TITLE}}

The host read the issue for you. Read the issue body, its labels and its
comments from `.sandcastle/{{ISSUE_CONTEXT_FILE}}` in this worktree. Use that
file instead of querying GitHub: this sandbox has no GitHub credential, and
any attempt to reach GitHub fails.

Work on branch {{BRANCH}}.

# REPOSITORY

This is Komotion, a frame-driven video animation library for Compose
Multiplatform: every animation is a pure function of the current frame number.
Read README.md and the module you touch before you change it. The modules are
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
