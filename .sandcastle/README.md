# Sandcastle factory

An agent factory that turns `ready-for-agent` issues into reviewed,
gate-green pull requests, plus an hourly issue triage pass. It runs on the
factory host (the Mac Studio), from this checkout, under launchd.

## Lanes

| Lane | Entry point | Timer | Woken by |
| --- | --- | --- | --- |
| `factory` | `main.mts` | every 5 minutes | `sandcastle-factory.yml` dispatch (issue labeled `ready-for-agent`, factory PR closed, CI finished on a `sandcastle/issue-*` branch) |
| `dependabot` | `dependabot.mts` | every 30 minutes | `sandcastle-dependabot.yml` dispatch (dependabot PR opened/updated, CI finished on a `dependabot/**` branch, push to main) |
| `triage` | `triage.mts` | every hour | nothing — it is the owner's scheduled pass |

Each lane is one pass per invocation: the launchd timer starts it, the
dispatch workflows wake it early by dropping a marker file into its event
directory (the lane's launchd agent watches that directory), and a lock
file keeps a new pass from starting while another is running.

## What a factory pass does

1. **Plan** — a planner agent reads the queued issues (the host read them;
   the sandbox has no GitHub credential), builds a dependency graph, and
   picks the issues that can be worked in parallel.
2. **Implement + review** — per ticket, in its own git worktree and Seatbelt
   sandbox: an implementer agent makes the change, then a reviewer agent
   refines it. Both run OpenCode with the local vLLM model.
3. **Gate** — the orchestrator (not the agent) runs `./gradlew desktopTest
   compileAllTargets` on the worktree: the desktop tests, plus a compile of
   the main sources of every target in every module (iOS, Android, wasmJs,
   desktop), so a change that breaks a non-desktop target is not delivered.
   The repository's CI runs the same command. Only a green branch is
   delivered.
4. **Deliver** — the host pushes the branch and opens a pull request that
   says `Closes #<n>`, so the issue closes when a human merges the PR.

A ticket that keeps failing collects strikes (`.sandcastle/logs/strikes.json`,
gitignored). After `SANDCASTLE_TICKET_STRIKES` (default 3) failed attempts the
factory hands it to a human: it adds `ready-for-interactive-agent`, removes
`ready-for-agent`, and comments the last failure on the issue. Putting
`ready-for-agent` back requeues it.

## What a triage pass does

The triage agent looks at the open issues and decides, per issue, which of
the repository's triage labels to add or remove (see
`docs/agents/triage-labels.md`); the host applies the labels and posts the
agent's notes. It never closes issues and never touches the factory's
workflow labels.

## Running a pass by hand

```bash
cd ~/Workspace/komotion-factory
npm install --prefix .sandcastle        # first time only

npx tsx .sandcastle/main.mts --check    # verify the environment
npx tsx .sandcastle/main.mts            # run one factory pass
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
- `SANDCASTLE_MODEL` — the agent model (`provider/model`).

The other knobs are environment variables with defaults in each entry point
(`SANDCASTLE_MAX_ISSUES`, `SANDCASTLE_PARALLELISM`,
`SANDCASTLE_TICKET_BUDGET_MINUTES`, `SANDCASTLE_TICKET_STRIKES`,
`GATE_COMMAND`, `GATE_MINUTES`, `TRIAGE_BATCH`).

The gate compiles every target in every module, so the host needs the
toolchains those targets build with: Xcode (iOS), and the Android SDK
(Android — the command-line tools alone are not enough):

```bash
sdkmanager --install "platforms;35" "build-tools;35.0.0"
```

## Logs

- `.sandcastle/logs/launchd-<lane>.log` / `.err.log` — the launchd agents'
  output.
- `.sandcastle/logs/` also holds the event marker directories
  (`factory-events`, `dependabot-events`), the strike ledger
  (`strikes.json`), and the per-ticket issue context files.
