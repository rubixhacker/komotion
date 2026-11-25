import { z } from "zod";
import { Check, failure } from "./dependabot-policy.mjs";

export const FactoryPr = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  mergeable: z.enum(["UNKNOWN", "MERGEABLE", "CONFLICTING"]),
  mergeStateStatus: z.string(),
  statusCheckRollup: z.array(Check).nullable(),
  labels: z.array(z.object({ name: z.string() })).optional(),
});
export type FactoryPr = z.infer<typeof FactoryPr>;

/** Only the factory's own issue branches, in this repository, against main. */
export function ownsFactoryPr(pr: FactoryPr): boolean {
  return (
    pr.state === "OPEN" &&
    pr.baseRefName === "main" &&
    !pr.isDraft &&
    !pr.isCrossRepository &&
    /^sandcastle\/issue-\d+$/.test(pr.headRefName)
  );
}

export function failingChecks(pr: FactoryPr) {
  return (pr.statusCheckRollup ?? []).filter(failure);
}

/** The workflow runs behind a pull request's failing checks, each once. */
export function failingRunIds(pr: FactoryPr): string[] {
  const ids = failingChecks(pr).flatMap((check) => {
    const id = /\/actions\/runs\/(\d+)/.exec(
      check.detailsUrl ?? check.targetUrl ?? "",
    )?.[1];
    return id ? [id] : [];
  });
  return [...new Set(ids)];
}

function runIdOf(check: {
  readonly detailsUrl?: string | null | undefined;
  readonly targetUrl?: string | null | undefined;
}): string | null {
  return /\/actions\/runs\/(\d+)/.exec(check.detailsUrl ?? check.targetUrl ?? "")?.[1] ?? null;
}

/** The checks GitHub stopped before they reached a verdict. */
export function cancelledChecks(pr: FactoryPr) {
  return (pr.statusCheckRollup ?? []).filter(
    (check) => (check.conclusion ?? check.state) === "CANCELLED",
  );
}

/** The workflow runs behind a pull request's cancelled checks, each once. */
export function cancelledRunIds(pr: FactoryPr): string[] {
  return [...new Set(cancelledChecks(pr).flatMap((check) => runIdOf(check) ?? []))];
}

/**
 * The checks GitHub completed without a pass or a fail: skipped, neutral, and
 * stale — a run against an older head says nothing about the current one. A
 * completed check is never left out of the summary: failed and cancelled
 * checks are accounted for on their own, and everything else completed is
 * summarized as skipped.
 */
export function skippedChecks(pr: FactoryPr) {
  return (pr.statusCheckRollup ?? []).filter(
    (check) =>
      check.__typename === "StatusContext"
        ? check.state === "NEUTRAL"
        : check.status === "COMPLETED" &&
          check.conclusion !== "SUCCESS" &&
          check.conclusion !== "CANCELLED" &&
          !failure(check),
  );
}

/** The checks GitHub completed as a pass. */
export function passedChecks(pr: FactoryPr) {
  return (pr.statusCheckRollup ?? []).filter(
    (check) =>
      check.__typename === "StatusContext"
        ? check.state === "SUCCESS"
        : check.status === "COMPLETED" && check.conclusion === "SUCCESS",
  );
}

/**
 * Whether the pull request is stuck on a check that was stopped, with nothing
 * else running or failed. A job that passes its time limit is reported as
 * cancelled, not failed, so it is neither repair work nor green: on
 * 15 November a factory pull request whose iPhone tests hung for an hour sat
 * that way with no one told. A failed check or a conflict takes the repair
 * path first, and a check still running may yet replace the cancelled one.
 */
export function stoppedOnCancelledChecks(pr: FactoryPr): boolean {
  return (
    ownsFactoryPr(pr) &&
    settled(pr) &&
    pr.mergeable !== "CONFLICTING" &&
    failingChecks(pr).length === 0 &&
    cancelledChecks(pr).length > 0
  );
}

/** Every check has reached a terminal state; pending/skipped-only stays unsettled. */
export function settled(pr: FactoryPr): boolean {
  const checks = pr.statusCheckRollup ?? [];
  if (checks.length === 0) return false;
  return checks.every((check) =>
    check.__typename === "StatusContext"
      ? ["SUCCESS", "FAILURE", "ERROR"].includes(check.state ?? "")
      : check.status === "COMPLETED",
  );
}

export function green(pr: FactoryPr): boolean {
  const checks = pr.statusCheckRollup ?? [];
  return (
    settled(pr) &&
    checks.length > 0 &&
    checks.every((check) => (check.conclusion ?? check.state) === "SUCCESS")
  );
}

export type CiDecision = "repair" | "wait" | "green" | "failed";

/**
 * Decide what a CI monitoring pass should do with the factory's own PR.
 *
 * A failing check or a conflicting base is repair work while attempts remain;
 * once the budget is spent the PR is reported failed rather than looped on. Arming
 * is owned by `arm-merge.mts`: under the default `green` policy a green, clean,
 * current-`main` PR needs no human approval; `approval` is the opt-in bar that
 * also waits for an authorized human to approve the exact head.
 */
export function decideCi(
  pr: FactoryPr,
  attempts: number,
  maxAttempts: number,
): CiDecision {
  if (!ownsFactoryPr(pr)) return "wait";
  const repairNeeded =
    failingChecks(pr).length > 0 || pr.mergeable === "CONFLICTING";
  if (repairNeeded) return attempts < maxAttempts ? "repair" : "failed";
  if (green(pr)) return "green";
  return "wait";
}
