# Parallel agents in worktrees

Rules for runs where agents build in their own git worktrees, including the single-agent interactive
case and several agents running at the same time. Each agent shares the machine's disk and Gradle
daemons with the others.

## One agent: create the worktree before editing files

An interactive implementation run creates its own worktree **before editing files**, even when no
other agent is running. Keep every edit, commit, test output, and gate log in that worktree, so a
concurrent reset in the interactive checkout cannot discard the run's work. The factory already does
this for each ticket; the same rule applies to an agent working by hand. Use `git worktree add` on a
branch for the change (check first that no worktree or branch for it already exists), stage the
gitignored local inputs below before the first build, and work from the new path.

## Setup

- Worktree setup stages the gitignored local inputs before any build, including a worktree made by
  hand for one interactive agent. The factory's `createFactorySandbox` invokes the trusted host
  checkout's copy of `scripts/ci/prepare-local-inputs.sh` by absolute path with the worktree as an
  explicit target as each worktree becomes ready. It never runs a script from the branch worktree on
  the host. For a worktree you create by hand with `git worktree add`, run the host checkout's copy
  once yourself before the first build, passing the worktree's path as the script's `TARGET_CHECKOUT`
  argument (for example `bash /path/to/host/scripts/ci/prepare-local-inputs.sh /path/to/worktree`).
  With no argument the script stages into its own checkout, so the hand-made worktree would stay
  empty.
- Gradle prepares a new worktree on the first invocation through
  `scripts/ci/prepare-worktree-inputs.sh`. It copies the gitignored `local.properties` from the
  checkout that owns the worktree's git dir; AGP needs it for `sdk.dir`. CI writes the file from
  secrets and is unaffected.
- Borrowing is confined to a linked worktree of the same repository: the only source is the checkout
  that owns the git dir, or the explicit `SANDCASTLE_LOCAL_INPUTS_DIR` override. The script reads
  nothing from the network. In the factory sandbox the host provisions that source checkout without
  gitignored credentials and controls the worktree mount, so no host key is copied into a sandbox.
- Lock a worktree that must outlive the run, such as an integration branch's:
  `git worktree lock --reason "<run name>" <path>`. `git worktree prune` skips a locked worktree,
  and `git worktree remove` refuses one unless forced twice. Unlock it with `git worktree unlock
  <path>` when the run ends.

## Delivering from a linked worktree

A fresh agent sets up and builds as above, then stops at the branch or pull request. The host or an
authorized human merges; an agent never does. The host holds the GitHub credential and the sandbox
does not, so an agent's work ends at the branch or pull request. The branch-checkout constraint in
`.sandcastle/worktrees.mts` applies to operations that need the branch checked out in the runtime
checkout: a branch checked out in another worktree cannot be rebased there until that worktree is
removed.
