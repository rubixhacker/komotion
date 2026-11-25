import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { BlockedByEdge, describeBlockedBy } from "./issue-blockers.mjs";

/**
 * The machine-readable state of the current pass, written on every transition.
 * A human or a monitoring check reads this instead of grepping journald, whose
 * output is mostly container lifecycle noise.
 */
export const FACTORY_PHASES = [
  "starting",
  "sweeping",
  "preflight",
  "planning",
  "reconciling",
  "closing",
  "authoring",
  "reviewing",
  "gating",
  "delivering",
  // Retained so status files from older passes still parse; new work releases its worker at PR delivery.
  "watching-ci",
  "finished",
  "stopped",
  "failed",
  // The pass did not run: the same failure repeated and the factory is waiting to retry.
  "backing-off",
] as const;

export const FactoryPhase = z.enum(FACTORY_PHASES);
export type FactoryPhase = z.infer<typeof FactoryPhase>;

/** The state of one ticket a parallel pass is working on. */
export const TicketStatus = z.object({
  phase: FactoryPhase,
  detail: z.string().default(""),
  updatedAt: z.string().min(1),
});
export type TicketStatus = z.infer<typeof TicketStatus>;

/** What the pass found in the ready queue, so a reader need not grep the journal for it. */
export const QueueSummary = z.object({
  ready: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  /** Held-back tickets, counted by the condition that excluded them. */
  heldBack: z.record(z.string(), z.number().int().positive()).default({}),
  /**
   * The ticket numbers behind each normalized reason, when the writer has
   * them. Keeps a status file written before this field existed readable: a
   * reader falls back to counts alone when it is absent.
   */
  heldBackNumbers: z.record(z.string(), z.array(z.number().int().positive())).optional(),
});
export type QueueSummary = z.infer<typeof QueueSummary>;

/**
 * Count held-back tickets by reason, keeping the ticket numbers alongside each
 * count. The reason itself is normalized so "branch sandcastle/issue-N exists"
 * for eight tickets reads as one line, with the eight numbers listed after it.
 */
export function summarizeQueue(
  ready: number,
  eligible: number,
  heldBack: ReadonlyArray<{ readonly number?: number; readonly reason: string }>,
): QueueSummary {
  const counts: Record<string, number> = {};
  const numbers: Record<string, number[]> = {};
  for (const entry of heldBack) {
    const reason = entry.reason
      .replace(/sandcastle\/issue-\d+/, "sandcastle/issue-N")
      .replace(/#\d+/, "#N");
    counts[reason] = (counts[reason] ?? 0) + 1;
    if (entry.number !== undefined) {
      const list = numbers[reason] ?? [];
      list.push(entry.number);
      numbers[reason] = list;
    }
  }
  return {
    ready,
    eligible,
    heldBack: counts,
    ...(Object.keys(numbers).length > 0 ? { heldBackNumbers: numbers } : {}),
  };
}

/** How many ticket numbers a held-back line spells out before summarizing the rest. */
const MAX_HELD_BACK_NUMBERS = 10;

/** The queue reason that means a ticket is held only by its retained branch. */
export const BRANCH_HOLD_REASON = "branch sandcastle/issue-N exists";

/** Issue numbers the queue holds back solely because a retained branch exists. */
export function heldByBranch(status: FactoryStatus): number[] {
  return status.queue?.heldBackNumbers?.[BRANCH_HOLD_REASON] ?? [];
}

export const FactoryStatus = z.object({
  passId: z.string().min(1),
  phase: FactoryPhase,
  /** The ticket the pass is working on, when the phase is ticket-scoped. */
  ticket: z.number().int().positive().nullable().default(null),
  detail: z.string().default(""),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  finishedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  /**
   * One entry per in-flight ticket in a parallel pass. The top-level
   * `phase`/`ticket`/`detail` are the most recent transition; this map is the
   * source of truth for what every ticket is doing at once.
   */
  tickets: z.record(z.string(), TicketStatus).default({}),
  /** How many pull requests this pass has opened. */
  delivered: z.number().int().nonnegative().default(0),
  /** Absent until the pass has read the queue, and in status files from older passes. */
  queue: QueueSummary.optional(),
  /**
   * Native "blocked by" edges the host read, keyed by issue number. Absent in
   * status files written before blockers were exposed, and when no candidate
   * is held by a native dependency.
   */
  blockers: z.record(z.string(), z.array(BlockedByEdge)).optional(),
});
export type FactoryStatus = z.infer<typeof FactoryStatus>;

/** A pass that has not finished is in flight; only those can go stale. */
export function statusIsStale(
  status: FactoryStatus,
  now: Date,
  maxIdleMs: number,
): boolean {
  if (status.finishedAt !== null) return false;
  const updated = Date.parse(status.updatedAt);
  if (Number.isNaN(updated)) return true;
  return now.getTime() - updated > maxIdleMs;
}

export function writeStatus(path: string, status: FactoryStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, path);
}

export function readStatus(path: string): FactoryStatus | null {
  if (!existsSync(path)) return null;
  return FactoryStatus.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Mark where a run starts in an agent log. The library appends every run of a
 * branch to one file, so without a banner a loop from an earlier pass reads as
 * a loop happening now.
 */
export function appendRunBanner(logPath: string, label: string, at: Date): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `\n=== ${label} started ${at.toISOString()} ===\n`);
}

/**
 * One block a timer or a human can read, with the pass's age in minutes. A
 * parallel pass prints one line per in-flight ticket; a single-ticket (or
 * pre-parallel) status prints the traditional one-liner.
 */
export function describeStatus(status: FactoryStatus, now: Date): string {
  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(status.updatedAt)) / 60_000),
  );
  const state = status.finishedAt === null ? "running" : "finished";
  const queue = status.queue;
  const queueLines =
    queue === undefined
      ? []
      : [
          `  queue: ${queue.ready} ready, ${queue.eligible} eligible`,
          ...Object.entries(queue.heldBack).map(([reason, count]) => {
            const numbers = queue.heldBackNumbers?.[reason] ?? [];
            const shown = numbers.slice(0, MAX_HELD_BACK_NUMBERS);
            const suffix =
              numbers.length === 0
                ? ""
                : ` (${shown.map((number) => `#${number}`).join(", ")}${
                    numbers.length > shown.length ? `, +${numbers.length - shown.length} more` : ""
                  })`;
            return `    ${count} held back: ${reason}${suffix}`;
          }),
        ];
  const blockerLines = Object.entries(status.blockers ?? {}).map(
    ([issue, edges]) => `  ${describeBlockedBy(Number(issue), edges)}`,
  );
  const ticketEntries = Object.entries(status.tickets ?? {});
  if (ticketEntries.length > 0) {
    const lines = ticketEntries.map(([number, ticket]) => {
      const ticketAge = Math.max(
        0,
        Math.round((now.getTime() - Date.parse(ticket.updatedAt)) / 60_000),
      );
      const detail = ticket.detail === "" ? "" : ` — ${ticket.detail}`;
      return `  #${number} ${ticket.phase}${detail}, updated ${ticketAge}m ago`;
    });
    return [
      `${state} pass, ${ticketEntries.length} ticket(s) in flight, updated ${ageMinutes}m ago`,
      ...lines,
      ...queueLines,
      ...blockerLines,
    ].join("\n");
  }
  const ticket = status.ticket === null ? "" : ` #${status.ticket}`;
  const detail = status.detail === "" ? "" : ` — ${status.detail}`;
  return [
    `${state} ${status.phase}${ticket}, updated ${ageMinutes}m ago${detail}`,
    ...queueLines,
    ...blockerLines,
  ].join("\n");
}
