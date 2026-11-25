/**
 * Re-arming escalated factory pull requests after the factory code changes.
 *
 * Escalation is deliberately terminal: a PR whose repair failed is handed to a
 * human and later sweeps leave it alone. That is right for a genuine fault,
 * but it also strands PRs when the repair code itself was wrong and has since
 * been fixed. Recording the factory code identity per PR lets a code change
 * give each affected PR exactly one fresh attempt, without turning escalation
 * into an unbounded retry.
 */

export type RearmablePr = {
  readonly prNumber: number;
  readonly head: string;
};

export type RearmPlan = {
  /** Keys to forget from the escalation ledger. */
  readonly alertKeys: readonly string[];
  /** Marks to forget from the attempt ledger. */
  readonly attemptMarks: readonly string[];
  /** PR numbers to record as re-armed at this code identity. */
  readonly prNumbers: readonly number[];
};

/** Escalation keys the CI sweep writes for one pull request head. */
function alertKeysFor(prNumber: number, head: string): readonly string[] {
  return [`pr:${prNumber}:${head}:conflict`, `pr:${prNumber}:${head}`];
}

/** Attempt marks the CI sweep consumes for one pull request head. */
function attemptMarksFor(prNumber: number, head: string): readonly string[] {
  return [`${head}:conflict`, `pr:${prNumber}:repair:${head}`, head];
}

export function planFactoryRearm(input: {
  readonly entries: readonly RearmablePr[];
  readonly alerted: ReadonlySet<string>;
  readonly repaired: ReadonlySet<string>;
  /** PR number to the factory code identity at which it was last re-armed. */
  readonly rearmed: ReadonlyMap<number, string>;
  readonly codeIdentity: string;
}): RearmPlan {
  const alertKeys: string[] = [];
  const attemptMarks: string[] = [];
  const prNumbers: number[] = [];
  for (const { prNumber, head } of input.entries) {
    // Once per code identity per PR. A later factory change arms it again.
    if (input.rearmed.get(prNumber) === input.codeIdentity) continue;
    const alerts = alertKeysFor(prNumber, head).filter((key) => input.alerted.has(key));
    // A PR still being repaired has no escalation to re-arm.
    if (alerts.length === 0) continue;
    alertKeys.push(...alerts);
    attemptMarks.push(...attemptMarksFor(prNumber, head).filter((mark) => input.repaired.has(mark)));
    prNumbers.push(prNumber);
  }
  return { alertKeys, attemptMarks, prNumbers };
}
