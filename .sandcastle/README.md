# Sandcastle factory

An agent factory that turns `ready-for-agent` issues into reviewed,
gate-green pull requests, plus an issue triage pass and a Dependabot watchdog.
It runs on the factory host (`~/Workspace/komotion-factory`) under launchd.

The host owns GitHub, git pushes and merges. Agents run in a Seatbelt sandbox
with no GitHub credential; the orchestrator runs the quality gate itself.

## Lanes

| Lane | Entry | Launchd agent | Writes to | Document |
| --- | --- | --- | --- | --- |
| Issue factory | `main.mts / drain.mts` | `com.rubixhacker.sandcastle.factory` | GitHub issues and pull requests | [lanes/factory.md](lanes/factory.md) |
| Dependabot watchdog | `dependabot.mts` | `com.rubixhacker.sandcastle.dependabot` | Dependabot pull requests | [lanes/dependabot.md](lanes/dependabot.md) |
| GitHub issue triage | `triage.mts` | `com.rubixhacker.sandcastle.triage` | issue comments and state labels | [lanes/triage.md](lanes/triage.md) |

`lanes/manifest.json` is the single definition of these lanes. The launchd
installer and lane wrapper read it at run time, and `npm run lanes:check`
verifies that the manifest, package scripts, lane docs and this table agree.

The factory and triage lanes have no polling timer: a GitHub dispatch workflow
drops an event marker and `WatchPaths` wakes the lane immediately. Dependabot
keeps a 30 minute timer as an independent fallback.

## What a factory pass does

1. **Reconcile** — rebase open factory branches onto the latest main, repair a
   conflict in a sandbox, re-run a failed CI check, and arm GitHub's native
   auto-merge on a green head (`--ci-repair-perform` and `--arm-merge` are
   direct, event-driven entry points).
2. **Plan** — a planner agent reads the queued issues (the host read them; the
   sandbox has no GitHub credential) and picks the issues that can be worked
   in parallel.
3. **Implement + review** — per ticket, in its own git worktree and Seatbelt
   sandbox: an implementer agent makes the change, then a reviewer agent
   refines it. The agent CLI is `pi` by default (`SANDCASTLE_AGENT=opencode`
   restores OpenCode). Session capture is disabled on every authoring path.
4. **Gate** — the orchestrator runs `./gradlew desktopTest compileAllTargets`
   on the worktree: the desktop tests plus a compile of every target in every
   module (iOS, Android, wasmJs, desktop). Only a green branch is delivered.
5. **Deliver** — the host pushes the branch and opens a pull request saying
   `Closes #<n>`, then arms native squash auto-merge. Work left on a branch by
   an earlier failed pass is gated and delivered instead of being lost.

A ticket that keeps failing collects strikes (`.sandcastle/logs/strikes.json`,
gitignored). After `SANDCASTLE_TICKET_STRIKES` failed attempts the factory hands
it to a human: it adds `ready-for-interactive-agent`, removes
`ready-for-agent`, and comments the last failure on the issue.
Putting `ready-for-agent` back requeues it.

## What a triage pass does

The triage agent looks at the open issues and decides, per issue, which of the
repository's triage labels to add or remove (see
`docs/agents/triage-labels.md`). The host applies the labels and posts the
agent's notes. It never closes issues and never touches workflow labels.

## Running a pass by hand

```bash
cd ~/Workspace/komotion-factory
npm install --prefix .sandcastle        # first time only

npx tsx .sandcastle/main.mts --check    # verify the environment
npx tsx .sandcastle/main.mts            # run one factory pass
npx tsx .sandcastle/drain.mts           # drain the queue
npx tsx .sandcastle/triage.mts          # run one triage pass
npx tsx .sandcastle/dependabot.mts      # run one dependabot pass
```

## Installing the launchd agents

```bash
bash scripts/install-sandcastle-macos.sh --enable    # install and start
bash scripts/install-sandcastle-macos.sh --status    # show the state
bash scripts/install-sandcastle-macos.sh --disable   # stop the lanes
```

## Environment

`.sandcastle/.env` (gitignored, mode 600) holds the host's credentials and
model endpoint. Copy `.sandcastle/.env.example` and fill it in:

```bash
cp .sandcastle/.env.example .sandcastle/.env
chmod 600 .sandcastle/.env
```

- `GH_TOKEN` — a fine-grained token for `rubixhacker/komotion` with Contents
  (read), Issues (read and write), and Pull requests (read and write).
- `VLLM_BASE_URL` — the OpenAI-compatible endpoint serving the model.
- `SANDCASTLE_MODEL` — the author model (`provider/model`).
- `SANDCASTLE_AGENT` — `pi` (default) or `opencode`.
- `SANDCASTLE_AUTO_MERGE` — `green` (default) or `approval`.

The other knobs are environment variables with defaults in each entry point
(`SANDCASTLE_MAX_ISSUES`, `SANDCASTLE_PARALLELISM`, `SANDCASTLE_TICKET_BUDGET_MINUTES`,
`SANDCASTLE_TICKET_STRIKES`, `SANDCASTLE_CI_SWEEP_MINUTES`, `GATE_COMMAND`,
`GATE_MINUTES`, `TRIAGE_BATCH`).

The gate compiles every target in every module, so the host needs Xcode (iOS)
and the Android SDK (Android — the command-line tools alone are not enough).
Install the platform and build tools AGP defaults to:

```bash
sdkmanager --install "platforms;35" "build-tools;36.0.0"
```

## Checks

```bash
npm --prefix .sandcastle run typecheck
npm --prefix .sandcastle run lint
npm --prefix .sandcastle test
npm --prefix .sandcastle run lanes:check
```

## Logs and state

State lives in `.sandcastle/logs/` (gitignored):

- `launchd-<lane>.log` / `.err.log` — the launchd agents' output.
- `<lane>-events/` — event markers; `queue-*` for new work, `delivery-*` for
  merged pull requests and completed CI runs.
- `ci-alerts.json`, `unarmed-factory-prs.json`, `factory-rearm.json`,
  `resume-attempts.json`, `targeted-repairs.json`, `flake-reruns.json` — repair
  and escalation ledgers.
- `strikes.json` — per-ticket failure counts; `status.json` — the live pass view.
- `factory-alerts.log` and `alert-state/` — deduplicated operator alerts.
