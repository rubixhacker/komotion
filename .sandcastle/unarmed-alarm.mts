import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { PullRequest } from "./queue.mjs";

/**
 * Alarm for delivered factory pull requests left without auto-merge.
 *
 * A green delivery that stays unarmed for several sweeps, with no pending-evidence
 * label and no other pull request claiming its issue, is reported to a human. The
 * missing `auto-merge` audit event becomes as visible as an arm: once per head,
 * with the reason it was not suppressed. Ownership and evidence holds clear the
 * streak, and a new head starts a fresh grace window.
 */

/** One delivered factory PR the sweep considers for the unarmed alarm. */
export interface UnarmedCandidate {
  readonly pr: number;
  readonly issue: number;
  readonly head: string;
  /** The delivery carries the device-evidence-pending hold label. */
  readonly evidencePending: boolean;
  /** Another open PR claims the same issue, which explains why this one waits. */
  readonly claimedByOtherPr: boolean;
  /** This exact head is already armed for rebase auto-merge, or has merged. */
  readonly armed: boolean;
}

/** The ledger key for one delivered head; a new push starts a fresh streak. */
export function unarmedKey(pr: number, head: string): string {
  return `pr:${pr}:${head}`;
}

/** An ownership or evidence reason that explains an unarmed hold. */
export function explainedHold(candidate: UnarmedCandidate): boolean {
  return candidate.evidencePending || candidate.claimedByOtherPr;
}

/** A head's unarmed streak. `alarmed` keeps a reported hold from repeating. */
export const UnarmedStreak = z.object({
  sweeps: z.number().int().positive(),
  alarmed: z.boolean(),
});
export type UnarmedStreak = z.infer<typeof UnarmedStreak>;

export const UnarmedStreaks = z.record(z.string(), UnarmedStreak);
export type UnarmedStreaks = z.infer<typeof UnarmedStreaks>;

export interface UnarmedPlan {
  readonly candidate: UnarmedCandidate;
  readonly key: string;
  /** Consecutive sweeps this head has been seen unarmed and unexplained. */
  readonly sweeps: number;
  /** True only on the sweep that first reaches the threshold. */
  readonly alarm: boolean;
}

export interface UnarmedPlanResult {
  readonly plans: readonly UnarmedPlan[];
  readonly streaks: UnarmedStreaks;
}

/**
 * Decide which delivered factory PRs have gone unarmed long enough to alarm.
 *
 * An armed head or one with an explanatory hold clears its streak. Every other
 * sweep adds one to the head's count, and reaching `threshold` alarms once per
 * head. Heads absent from this sweep are dropped, so merged or closed pull
 * requests leave no stale streak behind.
 */
export function planUnarmedAlarm(
  candidates: readonly UnarmedCandidate[],
  streaks: UnarmedStreaks,
  threshold: number,
): UnarmedPlanResult {
  const bar = Math.max(1, threshold);
  const next: UnarmedStreaks = {};
  const plans: UnarmedPlan[] = [];
  for (const candidate of candidates) {
    const key = unarmedKey(candidate.pr, candidate.head);
    if (candidate.armed || explainedHold(candidate)) {
      plans.push({ candidate, key, sweeps: 0, alarm: false });
      continue;
    }
    const prior = streaks[key];
    const sweeps = (prior?.sweeps ?? 0) + 1;
    const alarm = prior?.alarmed !== true && sweeps >= bar;
    next[key] = { sweeps, alarmed: prior?.alarmed === true || alarm };
    plans.push({ candidate, key, sweeps, alarm });
  }
  return { plans, streaks: next };
}

/**
 * Whether a pull request other than `prNumber` claims `issue`.
 *
 * Mirrors the queue's ownership rule: a closing reference, a `#N` mention in
 * the title or body, or a matching `sandcastle/issue-N` branch. The delivery's
 * own pull request is excluded, so its own branch or prose never suppresses it.
 */
export function claimedByOtherPr(
  prs: readonly PullRequest[],
  prNumber: number,
  issue: number,
): boolean {
  const reference = new RegExp(`(?:#|/issues/)${issue}(?![0-9])`);
  const branch = new RegExp(`sandcastle/issue-${issue}(?:\\D|$)`);
  return prs.some(
    (pr) =>
      pr.number !== prNumber &&
      (pr.closingIssuesReferences?.some((link) => link.number === issue) === true ||
        reference.test(pr.body) ||
        reference.test(pr.title) ||
        branch.test(pr.headRefName)),
  );
}

/** Where the unarmed streaks are kept between sweeps. */
export function unarmedLedgerPath(root: string): string {
  return resolve(root, ".sandcastle/logs/unarmed-factory-prs.json");
}

/** An unreadable ledger is an empty one: losing a streak only delays an alarm. */
export function readUnarmedStreaks(path: string): UnarmedStreaks {
  try {
    return UnarmedStreaks.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function writeUnarmedStreaks(path: string, streaks: UnarmedStreaks): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(streaks, null, 2)}\n`);
  renameSync(temporary, path);
}
