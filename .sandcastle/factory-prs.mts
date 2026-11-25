import { z } from "zod";
import { failingChecks, ownsFactoryPr, stoppedOnCancelledChecks, FactoryPr } from "./factory-ci.mjs";

const FACTORY_PR_FIELDS =
  "number,title,headRefName,headRefOid,baseRefName,state,isDraft,isCrossRepository,mergeable,mergeStateStatus,statusCheckRollup,labels";

/** The factory's own pull request, with the title the listing also carries. */
export const ListedFactoryPr = FactoryPr.extend({ title: z.string() });

export type ListedFactoryPr = z.infer<typeof ListedFactoryPr>;

export const FACTORY_PR_JSON_FIELDS = FACTORY_PR_FIELDS;

/**
 * The factory's own pull requests that cannot merge as they are: a check
 * failed, or the branch conflicts with `main`.
 *
 * A pull request owns its issue, so `queue()` excludes that issue and no later
 * pass revisits the request. Without this sweep a factory pull request that
 * fails CI sits red until a human opens it, because the repair loop only runs
 * for a request the current pass delivered.
 *
 * A pull request the factory did not open is not its own, so it is left alone.
 */
export function selectFailedFactoryPrs(
  listed: readonly ListedFactoryPr[],
): Array<{ pr: ListedFactoryPr; issue: number; conflict: boolean }> {
  const failed: Array<{ pr: ListedFactoryPr; issue: number; conflict: boolean }> = [];
  for (const pr of listed) {
    if (!ownsFactoryPr(pr)) continue;
    const conflict = pr.mergeable === "CONFLICTING";
    if (failingChecks(pr).length === 0 && !conflict) continue;
    const match = /^sandcastle\/issue-(\d+)$/.exec(pr.headRefName);
    if (match === null) continue;
    failed.push({ pr, issue: Number(match[1]), conflict });
  }
  return failed;
}

export type CancelledCheckAction =
  | { readonly kind: "rerun"; readonly pr: ListedFactoryPr; readonly key: string }
  | { readonly kind: "escalate"; readonly pr: ListedFactoryPr; readonly issue: number; readonly key: string };

/**
 * What to do with the factory's pull requests that are stuck on a cancelled
 * check. The first time a head is found that way its cancelled jobs are run
 * again: a hung simulator or a busy runner passes on a second run. A head
 * cancelled again after its re-run is the branch's doing or the runner's, and
 * neither is something a sandbox can see, so a human is told, once.
 *
 * `reruns` and `alerts` are the marks earlier sweeps left.
 */
export function planCancelledChecks(
  listed: readonly ListedFactoryPr[],
  reruns: ReadonlySet<string>,
  alerts: ReadonlySet<string>,
): CancelledCheckAction[] {
  const actions: CancelledCheckAction[] = [];
  for (const pr of listed) {
    if (!stoppedOnCancelledChecks(pr)) continue;
    const match = /^sandcastle\/issue-(\d+)$/.exec(pr.headRefName);
    if (match === null) continue;
    const rerunKey = `pr:${pr.number}:rerun-cancelled:${pr.headRefOid}`;
    const alertKey = `pr:${pr.number}:cancelled:${pr.headRefOid}`;
    if (!reruns.has(rerunKey)) actions.push({ kind: "rerun", pr, key: rerunKey });
    else if (!alerts.has(alertKey))
      actions.push({ kind: "escalate", pr, issue: Number(match[1]), key: alertKey });
  }
  return actions;
}
