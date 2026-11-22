# The factory agents' tools and denied commands

Everything here is for the agents that run inside a factory sandbox. The host
copies this directory into each worktree and points OpenCode at it
(`OPENCODE_CONFIG_DIR`), so the agents get it whatever the ticket's branch
contains. Nothing here runs on the host.

- `opencode.json` — the denied shell commands. OpenCode applies a deny rule
  even when it runs with permissions skipped, as the factory runs it, and
  applies it to each command in a compound line.

The denials exist because the host owns delivery: the sandbox must not push,
open pull requests, or reach GitHub, and must not destroy state it does not
own.
