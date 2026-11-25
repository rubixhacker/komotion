import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { gateFault } from "./gate-fault.mjs";
import { agentWasKilled, agentWentSilent } from "./retry.mjs";

/**
 * Whether a failed resume was stopped by the host or its plumbing, not by the
 * ticket. On 19 November 2026 a delivery outage (the pre-push Swift preflight,
 * SwiftPM checkout contention and a branch-name collision in the push probe)
 * cost eleven tickets their one resume: every head was marked before the run
 * and none was released when the host broke, so the next pass handed each one
 * to a human as `resume-exhausted`.
 *
 * The markers below are the exact phrases the factory already prints when one
 * of those pieces breaks. This is deliberately not a new free-form text
 * heuristic: a branch's own compile error, review finding or planner decline
 * must still consume its resume. The decision model's `hostFaultSuspected`
 * stays a separate, caller-supplied signal in `main.mts`.
 */

/** Host faults the factory already names elsewhere, reused as fault markers. */
export const INFRASTRUCTURE_FAULT_MARKERS = [
  // `main.mts` pass preflight: sandbox tools, Android SDK and model reachability.
  "Sandbox preflight failed",
  "OpenCode model unavailable",
  "Host review model unavailable",
  // `agent-preflight.mts`: the CLI session round trip and the delivery push probe.
  "Agent CLI session lifecycle preflight failed at",
  "Delivery push preflight failed at",
  "could not create delivery-push probe worktree",
] as const;

/**
 * The classified host reason in `text`, or null when the text names no known
 * infrastructure fault. Reuses the kill/stall and gate classifications rather
 * than adding a parallel set of patterns.
 */
export function infrastructureFault(text: string): string | null {
  for (const marker of INFRASTRUCTURE_FAULT_MARKERS) {
    if (text.includes(marker)) return marker;
  }
  if (agentWasKilled(text)) return "the agent's process was killed from outside";
  if (agentWentSilent(text)) return "the agent stopped producing output";
  return gateFault(text);
}

export const ResumeFault = z.object({
  reason: z.string(),
  count: z.number().int().positive(),
  firstAt: z.string().min(1),
  lastAt: z.string().min(1),
});
export type ResumeFault = z.infer<typeof ResumeFault>;

/** One entry per retained head. A different reason starts a fresh allowance. */
export const ResumeFaults = z.record(z.string(), ResumeFault);
export type ResumeFaults = z.infer<typeof ResumeFaults>;

/**
 * How many times one reason may free one head before the head stays marked.
 * The next pass then reaches the existing `resume-exhausted` handoff, so a head
 * that keeps failing for the same host reason still reaches a human.
 */
export const RESUME_FAULT_RETRIES = 2;

export interface ResumeFaultDecision {
  readonly faults: ResumeFaults;
  /** Null for a ticket's own failure: nothing is recorded and the head stays marked. */
  readonly reason: string | null;
  readonly count: number;
  /** True while the caller should call `forgetHead` and give this head a fresh resume. */
  readonly releaseHead: boolean;
}

/**
 * The decision one failed resume applies. `reason` is either a classified
 * fault from `infrastructureFault` or the fault advisor's verdict; null means
 * the ticket, not the host, failed and its one resume is consumed.
 */
export function resumeFaultDecision(
  faults: ResumeFaults,
  head: string,
  reason: string | null,
  now: string,
  retries: number = RESUME_FAULT_RETRIES,
): ResumeFaultDecision {
  if (reason === null) return { faults, reason: null, count: 0, releaseHead: false };
  const prior = faults[head];
  const same = prior !== undefined && prior.reason === reason;
  const count = same ? prior.count + 1 : 1;
  const fault: ResumeFault = {
    reason,
    count,
    firstAt: same ? prior.firstAt : now,
    lastAt: now,
  };
  return {
    faults: { ...faults, [head]: fault },
    reason,
    count,
    releaseHead: count <= retries,
  };
}

/** An unreadable or older-version ledger costs one retry, not the pass. */
export function readResumeFaults(path: string): ResumeFaults {
  try {
    return ResumeFaults.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function writeResumeFaults(path: string, faults: ResumeFaults): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(faults, null, 2)}\n`);
}
