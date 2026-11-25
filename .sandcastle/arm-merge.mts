/**
 * Arm rebase auto-merge for one factory pull request.
 *
 * `npm run arm-merge -- <pr>` is the single trust bar for both callers: the
 * factory's periodic sweep and the green-CI dispatch workflow. Every fact is
 * read again immediately before `--match-head-commit`, so an event that arrives
 * with a stale payload can never arm a head that has since moved. No admin or
 * unchecked merge exists, and a pull request that touches the factory's own
 * plumbing, workflows, `scripts/ci/`, or credentials waits for a human.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { green as requiredChecksGreen, touchesSensitivePath } from "./dependabot-policy.mjs";
import type { FactoryPr } from "./factory-ci.mjs";
import {
  autoMergeArmed,
  autoMergeDecision,
  type AutoMergeDecision,
  DEFAULT_AUTO_MERGE_POLICY,
  type AutoMergePolicy,
  type AutoMergeState,
  type GithubReview,
} from "./factory-delivery.mjs";
import {
  auditFactoryEvent,
  factoryCommand,
  factoryMainIsAncestor,
  factoryMergeState,
  factoryPrFiles,
  factoryPullRequest,
  factoryReviews,
} from "./factory-host.mjs";
import { REPO } from "./queue.mjs";

export const AutoMergePolicyInput = z.enum(["approval", "green"]);

/** Resolve the trust bar from a caller's environment; the factory and the CLI share this. */
export function autoMergePolicyFromEnv(env: NodeJS.ProcessEnv = process.env): AutoMergePolicy {
  return AutoMergePolicyInput.parse(env.SANDCASTLE_AUTO_MERGE ?? DEFAULT_AUTO_MERGE_POLICY);
}

export type ArmMergeFacts = {
  /** The pull request as GitHub sees it now, including its checks and mergeability. */
  readonly pr: FactoryPr;
  /** Reviews prove a current authorized human approval under the `approval` policy. */
  readonly reviews: readonly GithubReview[];
  /** Existing auto-merge state makes an already armed or merged request a no-op. */
  readonly state: AutoMergeState;
  /** Changed paths, so protected factory plumbing is never armed. */
  readonly files: readonly string[];
  /** Whether current `main` is an ancestor of the exact head being armed. */
  readonly mainIsAncestor: boolean;
  readonly policy: AutoMergePolicy;
};

/**
 * The full trust bar, applied to one snapshot of fresh facts. `autoMergeDecision`
 * still owns the policy split (a human approval under `approval`), while this
 * function adds the checks, ancestry, mergeability and protected-path gates the
 * script must honor under either policy.
 */
export function armMergeDecision(facts: ArmMergeFacts): AutoMergeDecision {
  if (autoMergeArmed(facts.state)) return { action: "wait", reason: "already merged or armed" };
  if (touchesSensitivePath(facts.files))
    return { action: "wait", reason: "touches factory plumbing, workflows or credentials" };
  if (!facts.mainIsAncestor) return { action: "wait", reason: "main is not an ancestor of the head" };
  if (!requiredChecksGreen(facts.pr))
    return { action: "wait", reason: "required checks are not green" };
  if (facts.pr.mergeable !== "MERGEABLE" || facts.pr.mergeStateStatus !== "CLEAN")
    return { action: "wait", reason: "pull request is not cleanly mergeable" };
  return autoMergeDecision(facts.pr, facts.reviews, facts.policy);
}

export type ArmResult =
  | { readonly action: "armed"; readonly head: string }
  | { readonly action: "wait"; readonly reason: string }
  | { readonly action: "error"; readonly reason: string };

function evaluate(
  root: string,
  pr: FactoryPr,
  state: AutoMergeState,
  policy: AutoMergePolicy,
): AutoMergeDecision {
  return armMergeDecision({
    pr,
    state,
    policy,
    reviews: policy === "green" ? [] : factoryReviews(root, pr.number),
    files: factoryPrFiles(root, pr.number),
    mainIsAncestor: factoryMainIsAncestor(root, pr.headRefOid),
  });
}

/**
 * Read the pull request, decide, then refetch `main` and re-read every fact
 * before the arm. A head that moved, a check that turned red, a review that was
 * dismissed, and a new touch of protected plumbing all stop the call.
 */
export function armFactoryPr(root: string, prNumber: number, policy: AutoMergePolicy): ArmResult {
  const listed = factoryPullRequest(root, prNumber);
  const initial = evaluate(root, listed, factoryMergeState(root, prNumber), policy);
  if (initial.action !== "arm") return initial;

  // A sweep can outlive its pass-start fetch, and an event can be seconds old.
  factoryCommand(root, "git", ["fetch", "origin", "main"]);
  const fresh = factoryPullRequest(root, prNumber);
  const refreshed = evaluate(root, fresh, factoryMergeState(root, prNumber), policy);
  if (refreshed.action !== "arm") return refreshed;
  if (fresh.headRefOid !== listed.headRefOid)
    return { action: "wait", reason: "head moved before the merge request" };

  try {
    factoryCommand(root, "gh", [
      "pr",
      "merge",
      String(prNumber),
      "--repo",
      REPO,
      "--auto",
      "--squash",
      "--match-head-commit",
      fresh.headRefOid,
    ]);
  } catch {
    // A concurrent human may have merged or armed it; verify the final state below.
  }
  const armed = autoMergeArmed(factoryMergeState(root, prNumber));
  auditFactoryEvent(root, { event: "auto-merge", pr: prNumber, head: fresh.headRefOid, armed });
  if (!armed) return { action: "error", reason: "auto-merge did not arm at this head" };
  return { action: "armed", head: fresh.headRefOid };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prNumber = Number(process.argv[2]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error("usage: npm run arm-merge -- <pr>");
    process.exitCode = 2;
  } else {
    const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
    const policy = autoMergePolicyFromEnv();
    try {
      const result = armFactoryPr(root, prNumber, policy);
      console.log(
        `#${prNumber}: ${result.action}${"reason" in result ? ` — ${result.reason}` : ""}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      auditFactoryEvent(root, { event: "auto-merge-error", pr: prNumber, error: reason });
      console.error(`#${prNumber}: auto-merge error: ${reason}`);
      process.exitCode = 1;
    }
  }
}
