import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { REPO } from "./queue.mjs";

/**
 * What the factory has tried on each ready ticket and failed to deliver.
 *
 * Every candidate a pass looks at ends in one of three places: delivered, a
 * strike here, or untouched because the pass ran out of room. A ticket that
 * collects `strikeLimit` strikes is handed to a human, so no ticket can be
 * declined, stalled or left on a dead branch pass after pass with nobody told.
 */
export const STRIKE_KINDS = [
  // The planner looked at the ticket and did not select it.
  "declined",
  // The author hit the ticket budget or repeated one tool call.
  "stalled",
  // The author reported BLOCKED, or finished without a deliverable commit.
  "blocked",
  // The independent review or the quality gate still failed after its repair rounds.
  "review-failed",
  "gate-failed",
  // A repair round committed nothing, or the head moved under the review.
  "repair-failed",
  // The ticket's run threw.
  "error",
  // A retained branch already spent its one resume at this head.
  "resume-exhausted",
  // A branch owns the ticket, and the factory can neither resume nor remove it.
  "stranded-branch",
] as const;
export const StrikeKind = z.enum(STRIKE_KINDS);
export type StrikeKind = z.infer<typeof StrikeKind>;

/** Strikes that end the factory's options at once: no later pass can do better. */
const FINAL_KINDS: ReadonlySet<StrikeKind> = new Set(["resume-exhausted", "stranded-branch"]);

export const Strike = z.object({
  at: z.string().min(1),
  kind: StrikeKind,
  detail: z.string(),
  /**
   * For a decline: the state of the world the planner judged. The ticket is
   * not put to the planner again until that state changes.
   */
  world: z.string().optional(),
});
export type Strike = z.infer<typeof Strike>;

export const TicketLedger = z.record(
  z.string(),
  z.object({ strikes: z.array(Strike) }),
);
export type TicketLedger = z.infer<typeof TicketLedger>;

/**
 * The label a handed-off ticket gets: the owner picks it up in an interactive
 * agent session. `queue()` excludes it.
 */
export const HANDOFF_LABEL = "ready-for-interactive-agent";
/** The label of a ticket whose next step is a decision only the owner can make. */
export const OWNER_DECISION_LABEL = "ready-for-human";
export const DEFAULT_STRIKE_LIMIT = 3;

export function strikesOf(ledger: TicketLedger, issue: number): readonly Strike[] {
  return ledger[String(issue)]?.strikes ?? [];
}

export function withStrike(
  ledger: TicketLedger,
  issue: number,
  strike: Strike,
): TicketLedger {
  return {
    ...ledger,
    [String(issue)]: { strikes: [...strikesOf(ledger, issue), strike] },
  };
}

export function withoutTicket(ledger: TicketLedger, issue: number): TicketLedger {
  const { [String(issue)]: _removed, ...rest } = ledger;
  return rest;
}

/**
 * Drop the record of every ticket that is no longer in the ready queue. A
 * ticket a human closed, relabelled or took over starts clean if it returns.
 */
export function onlyReady(
  ledger: TicketLedger,
  ready: readonly number[],
): TicketLedger {
  const keep = new Set(ready.map(String));
  return Object.fromEntries(
    Object.entries(ledger).filter(([issue]) => keep.has(issue)),
  );
}

/**
 * Whether a ticket has used up the factory's attempts. A branch that already
 * spent its resume cannot be retried at all, so that strike alone is enough.
 */
export function handoffDue(
  ledger: TicketLedger,
  issue: number,
  strikeLimit: number = DEFAULT_STRIKE_LIMIT,
): boolean {
  const strikes = strikesOf(ledger, issue);
  return (
    strikes.length >= strikeLimit ||
    strikes.some((strike) => FINAL_KINDS.has(strike.kind))
  );
}

/**
 * The planner's standing decline of a ticket, when nothing it judged has
 * changed since. Asking again would return the same answer and spend a pass.
 */
export function standingDecline(
  ledger: TicketLedger,
  issue: number,
  world: string,
): Strike | null {
  const last = strikesOf(ledger, issue).at(-1);
  return last !== undefined && last.kind === "declined" && last.world === world
    ? last
    : null;
}

/** What a planner decision depends on: main, and the ticket's own text. */
export function declineWorld(originMain: string, issueUpdatedAt: string | undefined): string {
  return `${originMain}|${issueUpdatedAt ?? ""}`;
}

export interface PlanningSplit<T> {
  /** Tickets the planner is asked about this pass. */
  readonly ask: readonly T[];
  /** Tickets held out of planning, each with the reason it prints. */
  readonly skipped: ReadonlyArray<{
    readonly ticket: T;
    readonly reason: string;
    /** The planner already declined with nothing changed — route to a human now. */
    readonly standing: boolean;
  }>;
}

/**
 * Split the eligible queue into what the planner sees and what waits.
 *
 * A ticket whose handoff is due is never planned again: if the handoff itself
 * failed (GitHub was unreachable), the next pass retries the handoff, not the
 * work.
 */
export function splitForPlanning<T extends { readonly number: number; readonly updatedAt?: string | undefined }>(
  eligible: readonly T[],
  ledger: TicketLedger,
  originMain: string,
  strikeLimit: number = DEFAULT_STRIKE_LIMIT,
): PlanningSplit<T> {
  const ask: T[] = [];
  const skipped: Array<{ ticket: T; reason: string; standing: boolean }> = [];
  for (const ticket of eligible) {
    if (handoffDue(ledger, ticket.number, strikeLimit)) {
      skipped.push({ ticket, reason: "out of attempts; handing off to a human", standing: false });
      continue;
    }
    const decline = standingDecline(
      ledger,
      ticket.number,
      declineWorld(originMain, ticket.updatedAt),
    );
    if (decline !== null) {
      skipped.push({
        ticket,
        reason: `the planner declined it and nothing has changed since: ${decline.detail}`,
        standing: true,
      });
      continue;
    }
    ask.push(ticket);
  }
  return { ask, skipped };
}

/**
 * Strike every ticket the planner declined, stamped with the state it judged.
 * `asked` is the list the planner was given, so the stamp matches the one
 * `splitForPlanning` compares against next pass.
 */
export function recordDeclines(
  desk: Pick<TicketDesk, "strike" | "needsOwner" | "needsInteractive">,
  declined: ReadonlyArray<{
    readonly number: number;
    readonly reason: string;
    readonly ownerDecision?: boolean;
    readonly outOfSandbox?: boolean;
  }>,
  asked: ReadonlyArray<{ readonly number: number; readonly updatedAt?: string | undefined }>,
  originMain: string,
): void {
  for (const entry of declined) {
    const ticket = asked.find((candidate) => candidate.number === entry.number);
    if (ticket === undefined) continue;
    // A decision the owner has not made is not something another pass can
    // wait out: three declines would only delay the same handoff.
    if (entry.ownerDecision === true && desk.needsOwner(entry.number, entry.reason)) continue;
    // A target the sandbox cannot reach is the same: no later pass can write
    // it, so route to an interactive agent now instead of spending three strikes.
    if (entry.outOfSandbox === true && desk.needsInteractive(entry.number, entry.reason)) continue;
    desk.strike(
      entry.number,
      "declined",
      entry.reason,
      declineWorld(originMain, ticket.updatedAt),
    );
  }
}

const KIND_TEXT: Record<StrikeKind, string> = {
  declined: "The planner declined it",
  stalled: "The author stalled",
  blocked: "The author stopped without a deliverable",
  "review-failed": "The independent review did not pass",
  "gate-failed": "The quality gate did not pass",
  "repair-failed": "A repair round produced nothing to review",
  error: "The run failed",
  "resume-exhausted": "The retained branch already used its one resume",
  "stranded-branch": "A branch owns the ticket and the factory cannot resume it",
};

export interface RetainedBranch {
  readonly name: string;
  readonly head: string;
  readonly commits: number;
}

/** The comment a human reads on the issue: what was tried, and how to requeue it. */
export function handoffComment(
  strikes: readonly Strike[],
  branch: RetainedBranch | null,
  published = false,
): string {
  const lines = [
    `The Sandcastle factory could not deliver this ticket and has stopped trying. It now carries \`${HANDOFF_LABEL}\` instead of \`ready-for-agent\`, so no pass will pick it up.`,
    "",
    "What happened:",
    ...strikes.map(
      (strike) =>
        `- ${strike.at}: ${KIND_TEXT[strike.kind]}${strike.detail === "" ? "." : ` — ${oneLine(strike.detail)}`}`,
    ),
    "",
  ];
  if (branch !== null) {
    lines.push(
      published
        ? `Branch \`${branch.name}\` holds ${branch.commits} undelivered commit(s) at \`${branch.head.slice(0, 12)}\` and has been pushed to the remote. Start the interactive session from that branch: it carries the factory's work, including the findings it addressed. The branch is unverified — its checks failed or its review did not pass.`
        : `Branch \`${branch.name}\` on the factory host holds ${branch.commits} undelivered commit(s) at \`${branch.head.slice(0, 12)}\`; it could not be pushed. The factory resumes a retained head once. To let it try again, push a new commit to that branch (a new head earns a fresh resume) or delete the branch (the next run starts from main).`,
      "",
    );
  }
  lines.push(
    `To requeue: resolve what is listed above, then put \`ready-for-agent\` back and remove \`${HANDOFF_LABEL}\`. The factory starts the ticket with a clean record.`,
  );
  return lines.join("\n");
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim().slice(0, 600);
}

/** Runs one host command and returns its output. Injected so a handoff is testable without GitHub. */
export type HostCommand = (program: string, args: readonly string[]) => string;

/**
 * Hand a ticket to a human: explain on the issue, then swap the label.
 *
 * The comment goes first. If the label change then fails the ticket is still
 * ready, the ledger still says the handoff is due, and the next pass retries;
 * the other order could leave a relabelled ticket with no explanation.
 */
export function applyHandoff(
  run: HostCommand,
  issue: number,
  comment: string,
): void {
  run("gh", ["issue", "comment", String(issue), "--repo", REPO, "--body", comment]);
  run("gh", [
    "issue",
    "edit",
    String(issue),
    "--repo",
    REPO,
    "--add-label",
    HANDOFF_LABEL,
    "--remove-label",
    "ready-for-agent",
  ]);
}

/** The comment on a ticket the planner sent to its owner for a decision. */
export function ownerDecisionComment(reason: string): string {
  return [
    `The Sandcastle factory's planner declined this ticket because it waits on a decision from the owner. It now carries \`${OWNER_DECISION_LABEL}\` instead of \`ready-for-agent\`, so no pass will pick it up.`,
    "",
    `The planner's reason: ${oneLine(reason)}`,
    "",
    `To requeue: write the decision on this issue, then put \`ready-for-agent\` back and remove \`${OWNER_DECISION_LABEL}\`. If no decision is needed after all, relabel it the same way and say so here.`,
  ].join("\n");
}

/** Send a ticket to its owner for a decision: explain on the issue, then swap the label. */
export function applyOwnerDecision(run: HostCommand, issue: number, comment: string): void {
  run("gh", ["issue", "comment", String(issue), "--repo", REPO, "--body", comment]);
  run("gh", [
    "issue",
    "edit",
    String(issue),
    "--repo",
    REPO,
    "--add-label",
    OWNER_DECISION_LABEL,
    "--remove-label",
    "ready-for-agent",
  ]);
}

/** The comment on a ticket whose named target the factory sandbox cannot reach. */
export function outOfSandboxComment(reason: string): string {
  return [
    `The Sandcastle factory's planner declined this ticket because its target is outside the factory sandbox. It now carries \`${HANDOFF_LABEL}\` instead of \`ready-for-agent\`, so no pass will pick it up. No strike was recorded for this decline.`,
    "",
    `The planner's reason: ${oneLine(reason)}`,
    "",
    `To requeue: run this ticket in an interactive agent session that can reach the target, then put \`ready-for-agent\` back and remove \`${HANDOFF_LABEL}\`.`,
  ].join("\n");
}

/** An unreadable ledger is an empty one: the cost is a few repeated attempts, not a stuck queue. */
export function readLedger(path: string): TicketLedger {
  try {
    return TicketLedger.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function writeLedger(path: string, ledger: TicketLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(temporary, path);
}

export interface TicketDesk {
  /** Record a strike, and hand the ticket off when that was its last attempt. */
  strike(issue: number, kind: StrikeKind, detail: string, world?: string): void;
  /**
   * The planner found the ticket waits on its owner's decision: relabel it
   * for the owner. Returns false when GitHub refused, so the caller records an
   * ordinary decline and the next pass tries again.
   */
  needsOwner(issue: number, reason: string): boolean;
  /**
   * The planner found the ticket's target outside the sandbox: route it to an
   * interactive agent with no strike. Returns false when GitHub refused, so
   * the caller records an ordinary decline and the next pass tries again.
   */
  needsInteractive(issue: number, reason: string): boolean;
  /** The ticket was delivered: forget its strikes. */
  delivered(issue: number): void;
  /** Hand off every ticket whose handoff is due, including ones an earlier pass could not complete. */
  handOffDue(): void;
  ledger(): TicketLedger;
}

/**
 * The ledger bound to its file and to the host actions a handoff needs.
 *
 * Each call reads and writes the file synchronously, so tickets running in
 * parallel within one pass cannot lose each other's strikes.
 */
export function ticketDesk(options: {
  readonly path: string;
  readonly strikeLimit?: number;
  readonly now: () => Date;
  readonly run: HostCommand;
  /** The retained branch for a ticket, or null when it holds no commits. */
  readonly branchOf: (issue: number) => RetainedBranch | null;
  /** Publishes a retained branch so a human starts from the work already done, not main. */
  readonly publishBranch: (branch: RetainedBranch) => void;
  readonly alert: (message: string) => void;
  readonly log: (message: string) => void;
}): TicketDesk {
  const limit = options.strikeLimit ?? DEFAULT_STRIKE_LIMIT;
  const handOff = (issue: number): void => {
    const ledger = readLedger(options.path);
    const strikes = strikesOf(ledger, issue);
    if (strikes.length === 0) return;
    const branch = options.branchOf(issue);
    // Publish before commenting: the issue must tell the human where the work is. A push failure
    // is reported in the comment and the handoff still happens — publishing is best-effort.
    let published = false;
    if (branch !== null) {
      try {
        options.publishBranch(branch);
        published = true;
      } catch (error) {
        options.log(
          `#${issue}: could not publish ${branch.name} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); the handoff comment will say so.`,
        );
      }
    }
    try {
      applyHandoff(options.run, issue, handoffComment(strikes, branch, published));
    } catch (error) {
      // The strikes stay, so the ticket stays out of planning and the next pass retries this.
      options.log(
        `#${issue}: handoff failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); it will be retried next pass.`,
      );
      return;
    }
    writeLedger(options.path, withoutTicket(readLedger(options.path), issue));
    const last = strikes.at(-1);
    const summary = `ticket #${issue} handed to a human after ${strikes.length} failed attempt(s)${
      last === undefined ? "" : `; last: ${KIND_TEXT[last.kind]}`
    }${branch === null ? "" : `; ${branch.name} holds ${branch.commits} commit(s)`}`;
    options.log(`#${issue}: handed off (${HANDOFF_LABEL}).`);
    options.alert(summary);
  };
  return {
    strike(issue, kind, detail, world) {
      const strike: Strike = {
        at: options.now().toISOString(),
        kind,
        detail,
        ...(world === undefined ? {} : { world }),
      };
      const ledger = withStrike(readLedger(options.path), issue, strike);
      writeLedger(options.path, ledger);
      const count = strikesOf(ledger, issue).length;
      options.log(`#${issue}: strike ${count}/${limit} (${kind}).`);
      if (handoffDue(ledger, issue, limit)) handOff(issue);
    },
    needsOwner(issue, reason) {
      try {
        applyOwnerDecision(options.run, issue, ownerDecisionComment(reason));
      } catch (error) {
        options.log(
          `#${issue}: could not move it to ${OWNER_DECISION_LABEL} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); recorded as a decline.`,
        );
        return false;
      }
      writeLedger(options.path, withoutTicket(readLedger(options.path), issue));
      options.log(`#${issue}: waits on the owner's decision; moved to ${OWNER_DECISION_LABEL}.`);
      return true;
    },
    needsInteractive(issue, reason) {
      try {
        applyHandoff(options.run, issue, outOfSandboxComment(reason));
      } catch (error) {
        options.log(
          `#${issue}: could not move it to ${HANDOFF_LABEL} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); recorded as a decline.`,
        );
        return false;
      }
      writeLedger(options.path, withoutTicket(readLedger(options.path), issue));
      options.log(`#${issue}: target is outside the sandbox; moved to ${HANDOFF_LABEL}.`);
      return true;
    },
    delivered(issue) {
      writeLedger(options.path, withoutTicket(readLedger(options.path), issue));
    },
    handOffDue() {
      const ledger = readLedger(options.path);
      for (const issue of Object.keys(ledger).map(Number))
        if (handoffDue(ledger, issue, limit)) handOff(issue);
    },
    ledger: () => readLedger(options.path),
  };
}
