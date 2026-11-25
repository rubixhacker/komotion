# Issue factory lane

The factory turns `ready-for-agent` issues into reviewed, gate-green pull
requests. One invocation of `main.mts` is one pass; `drain.mts` runs passes
back to back until the queue settles, so a burst of events does not leave
tickets waiting for another launch.

## Wake

This lane has no polling timer. `com.rubixhacker.sandcastle.factory` watches
`.sandcastle/logs/factory-events`. The GitHub dispatch workflow drops a marker
there through `scripts/ci/sandcastle-enqueue.sh`; `enqueue.mts` classifies the
event as `queue-` or `delivery-` and writes a JSON marker with an atomic rename.
`main.mts` acknowledges events with a snapshot so an event that arrives during
a repair survives to the next pass. `RunAtLoad` covers a host restart.

## What a pass does

1. Keep open factory branches rebased onto main and merge conflicts repaired
   by the conflict-repair path; escalate a conflict that cannot be rebased.
2. Read the queue, skip tickets already claimed by an open pull request, and
   plan the issues that can run in parallel.
3. Implement and review each ticket in its own worktree and Seatbelt sandbox,
   with the agent runtime selected by `SANDCASTLE_AGENT` (`pi` by default).
4. Run `./gradlew desktopTest compileAllTargets` on the worktree. The gate is
   run by the orchestrator, never by the agent.
5. Push and open a pull request, then arm GitHub's native squash auto-merge.
   A branch that carried undelivered work from an earlier failed pass is gated
   and delivered rather than failing with "no commits".

A ticket that keeps failing collects a strike. After
`SANDCASTLE_TICKET_STRIKES` attempts it is handed to a human.

## Scripts

- `npm --prefix .sandcastle run start` — one pass
- `npm --prefix .sandcastle run drain` — the lane entry point
- `npm --prefix .sandcastle run check` — non-mutating environment check
