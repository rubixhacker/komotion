/**
 * What a sweep does with one factory pull request that cannot merge as it is:
 * its checks failed, or it conflicts with `main`.
 *
 * A pull request earns one automated repair per head, because a branch whose
 * head never moves would otherwise consume a repair run every sweep. A repair
 * that changes nothing re-runs the failed jobs, which clears a flaky check.
 * Once the repair has had its chance and the checks have failed again the
 * request needs a human, so it is escalated once per head and later sweeps
 * leave it alone.
 *
 * A repair that pushes gives the request a new head, so the per-head rule
 * alone would let a repair whose fix keeps failing run forever. A request
 * therefore gets at most `MAX_CHECK_REPAIRS_PER_PR` check repairs over all its
 * heads; after that a failing head is escalated like a spent one.
 *
 * A conflict is counted apart from the checks: a head whose check repair is
 * spent still earns one rebase when `main` moves into its way. The conflict
 * comes first, because the rebase gives the request a new head and its checks
 * run again on it.
 */
export type SweepEntry = {
  readonly prNumber: number;
  readonly issue: number;
  readonly head: string;
  readonly conflict: boolean;
};

export type SweepAction = SweepEntry & {
  readonly kind: "rebase" | "repair" | "escalate" | "skip";
  /**
   * What the ci-alerts ledger records for this entry: the head, marked when it
   * is a conflict, prefixed by the pull request number. The prefix is what lets
   * a merged delivery's every escalated head be cleared at once, so the
   * delivery-failure gauge counts only deliveries failing right now.
   */
  readonly key: string;
  /** What the resume-attempts ledger records for a rebase or repair attempt on this entry. */
  readonly attemptMark: string;
};

/**
 * The escalation for a conflicting request whose deterministic rebase produced
 * no commit. The rebase has already been attempted, so leaving the branch
 * retained without telling a human is what let conflicts sit dirty for hours.
 * The key matches the conflict escalation the planner would otherwise reach on
 * a later sweep, so the alert still fires once per head.
 */
export function noRebaseCommitEscalation(
  prNumber: number,
  issue: number,
  head: string,
  branch: string,
): { readonly key: string; readonly message: string } {
  return {
    key: `pr:${prNumber}:${head}:conflict`,
    message: `factory pull request #${prNumber} (issue #${issue}) still conflicts with main at ${head.slice(0, 7)} after a deterministic rebase produced no commit; it needs a human — push a rebased commit to ${branch} or delete the branch`,
  };
}

/** Check repairs one request may spend across all its heads. */
export const MAX_CHECK_REPAIRS_PER_PR = 3;

/** The ledger entry that counts one check repair against a request. */
export function checkRepairMark(prNumber: number, head: string): string {
  return `pr:${prNumber}:repair:${head}`;
}

function checkRepairsSpent(prNumber: number, repaired: ReadonlySet<string>): number {
  const prefix = `pr:${prNumber}:repair:`;
  let spent = 0;
  for (const key of repaired) if (key.startsWith(prefix)) spent += 1;
  return spent;
}

/**
 * Decide, for every such request, whether to rebase it, repair it, tell a
 * human, or leave it alone. The sets are keyed by head, so a push earns a
 * fresh attempt and a head that has already been handled cannot spend another
 * run.
 */
export function planCiSweep(
  entries: readonly SweepEntry[],
  repaired: ReadonlySet<string>,
  alerted: ReadonlySet<string>,
): SweepAction[] {
  return entries.map((entry) => {
    const attemptMark = entry.conflict ? `${entry.head}:conflict` : entry.head;
    const key = `pr:${entry.prNumber}:${attemptMark}`;
    const capped =
      !entry.conflict && checkRepairsSpent(entry.prNumber, repaired) >= MAX_CHECK_REPAIRS_PER_PR;
    // A check repair is looked up by its own mark, never by the bare head: the
    // author's resume of a kept branch records the bare head in the same
    // ledger, and a resumed branch delivered unchanged then looked repaired
    // before any repair had run.
    const spent = repaired.has(
      entry.conflict ? attemptMark : checkRepairMark(entry.prNumber, entry.head),
    );
    if (!spent && !capped)
      return { ...entry, key, attemptMark, kind: entry.conflict ? "rebase" : "repair" };
    if (!alerted.has(key)) return { ...entry, key, attemptMark, kind: "escalate" };
    return { ...entry, key, attemptMark, kind: "skip" };
  });
}
