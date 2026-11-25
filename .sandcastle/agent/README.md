# The factory agents' tools and denied commands

Everything here is for agents that run inside a factory sandbox. The host builds
one pi agent directory per pass from `agent-provider.mts`: it carries the
provider catalog, a copy of `skills/`, a writable session directory and the
shell policy. `PI_CODING_AGENT_DIR` points every sandbox at it. The
`SANDCASTLE_AGENT=opencode` control route uses this directory for
`OPENCODE_CONFIG_DIR` instead. Nothing here runs on the host.

The boundary is the same on both routes: the host owns GitHub, pushes and
merges. An agent that runs `gh` has no credential, and suppressing a check or
relaxing a threshold hides a branch defect rather than fixing it.

## Layout

- `bin/` — the commands agents run: `gradle`, `find-symbol`, `lib-source`. Each
  is a one-line wrapper around a script in `cli/`.
- `cli/` — the scripts, in TypeScript that the sandbox's Node runs directly.
  Their tests are `../agent-tools.test.mts`.
- `skills/factory-tools/SKILL.md` — how to build and search in the sandbox.
  The author prompt tells the agent to load it before anything else.
- `opencode.json` — the source of the denied command list. The OpenCode route
  reads it directly; `agent-provider.mts` generates the same rules into
  `guard.sh` as pi's `shellPath`, so the two routes cannot drift.

The scripts are commands on disk rather than tools inside an agent plugin: a
plugin needs an npm install each time a sandbox starts, and with `./gradlew`
denied a failed install would leave an agent unable to build.

## Changing a deny rule

Change `permission.bash` in `opencode.json`. The generated pi guard reads that
list, so both routes enforce the same boundary. A pattern that matches the
tools' own command lines locks the agents out of building, and
`../agent-tools.test.mts` fails on one that does.
