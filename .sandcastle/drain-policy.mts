import type { FactoryStatus } from "./status.mjs";

export type DrainStep =
  | { readonly next: "continue" }
  | { readonly next: "stop"; readonly reason: string; readonly exitCode: number };

/**
 * Whether another pass is worth running, decided from the pass's own record.
 *
 * The driver used to capture the pass's whole output to find one line in it.
 * That kept every line out of the journal until the pass ended, hours later,
 * and a pass that printed more than the capture buffer was killed for it. The
 * pass now writes to the journal directly, and the driver reads the status
 * file the pass already maintains.
 */
export function afterPass(input: {
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** The status file after the pass, or null when it is missing or unreadable. */
  readonly status: FactoryStatus | null;
  /** When the driver started this pass. */
  readonly startedAt: Date;
  readonly branchesBefore: string;
  readonly branchesAfter: string;
}): DrainStep {
  if (input.exitCode === 75)
    return { next: "stop", reason: "another pass holds the lock", exitCode: 0 };
  if (input.exitCode !== 0)
    return {
      next: "stop",
      reason:
        input.exitCode === null
          ? `the pass was killed by ${input.signal ?? "a signal"}`
          : `the pass failed with exit ${input.exitCode}`,
      exitCode: input.exitCode ?? 1,
    };
  const status = input.status;
  // A status older than this pass belongs to an earlier one: the pass exited
  // before it recorded anything, so there is nothing to base another pass on.
  if (status === null || Date.parse(status.startedAt) < input.startedAt.getTime() - 1_000)
    return { next: "stop", reason: "the pass recorded no status", exitCode: 0 };
  if (status.phase === "backing-off")
    return {
      next: "stop",
      reason: `the factory is backing off (${status.detail})`,
      exitCode: 0,
    };
  if (status.phase !== "finished")
    return { next: "stop", reason: `the pass ended in ${status.phase}`, exitCode: 0 };
  const eligible = status.queue?.eligible ?? 0;
  if (eligible === 0)
    return { next: "stop", reason: "no eligible tickets remain", exitCode: 0 };
  // The pass's own count comes first: a pull request that merged during the
  // pass takes its branch with it, so the branch list can end as it began.
  // On 15 November a seven-hour pass delivered two tickets, both merged before
  // it ended, and the drain stopped with 36 tickets still eligible.
  if (status.delivered === 0 && input.branchesAfter === input.branchesBefore)
    return {
      next: "stop",
      reason: `the pass delivered nothing and pushed no branch; ${eligible} eligible ticket(s) made no progress`,
      exitCode: 0,
    };
  return { next: "continue" };
}

/** The least time between the end of one pass and the first pass of the next drain. */
export const DRAIN_SPACING_MS = 150_000;

/**
 * How long a new drain waits before its first pass. A GitHub event starts the
 * lane as soon as it stops, so a run of events that each find nothing to do
 * would otherwise start the factory often enough to flood the host and raise
 * alerts. Waiting out the spacing keeps healthy starts under five in ten
 * minutes.
 */
export function startDelayMs(
  status: FactoryStatus | null,
  now: Date,
  spacingMs = DRAIN_SPACING_MS,
): number {
  return spacingDelayMs(status === null ? null : Date.parse(status.updatedAt), now.getTime(), spacingMs);
}

/**
 * How long a run woken by an event waits, given when the last run ended (epoch
 * milliseconds, or null when there was none). A clock that moved backwards, or
 * a time that cannot be read, never holds the run.
 */
export function spacingDelayMs(
  lastEndedMs: number | null,
  nowMs: number,
  spacingMs = DRAIN_SPACING_MS,
): number {
  if (lastEndedMs === null) return 0;
  const sinceLast = nowMs - lastEndedMs;
  if (!Number.isFinite(sinceLast) || sinceLast < 0) return 0;
  return Math.max(0, spacingMs - sinceLast);
}

/**
 * Whether `main` now holds factory code the running pass did not load.
 *
 * A pass loads its code once and then refills its slots for as long as tickets
 * keep arriving. On 15 November one pass ran for seven hours that way, and two
 * fixes merged in its first hour (a repair the sweep kept refusing, and the
 * Swift compile on the macOS runner) were in use by nothing: the tickets it
 * took on afterwards were handled by the code those fixes replaced. A pass that
 * sees this takes no new tickets, finishes the ones it has, and ends; the
 * driver then fast-forwards the checkout and the next pass loads the new code.
 *
 * `loaded` and `merged` are the tree of `.sandcastle/` in the checkout and on
 * `origin/main`. A runtime pinned to a commit is meant to differ from `main`.
 */
export function factoryCodeMoved(loaded: string, merged: string, pin: string | undefined): boolean {
  if (pin !== undefined && pin !== "") return false;
  return loaded !== "" && merged !== "" && loaded !== merged;
}
