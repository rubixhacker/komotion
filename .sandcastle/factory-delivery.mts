import { z } from "zod";
import { green as requiredChecksGreen } from "./dependabot-policy.mjs";
import { type FactoryPr, ownsFactoryPr } from "./factory-ci.mjs";

/** The GitHub review fields needed to prove an authorized human approved this exact head. */
export const GithubReview = z.object({
  id: z.number().int().positive(),
  state: z.string(),
  commit_id: z.string().nullable(),
  submitted_at: z.string(),
  author_association: z.string(),
  user: z.object({
    login: z.string(),
    type: z.string(),
  }),
});
export type GithubReview = z.infer<typeof GithubReview>;

export type AutoMergeDecision =
  | { readonly action: "arm" }
  | { readonly action: "wait"; readonly reason: string };

/**
 * When auto-merge arms. The full trust bar lives in `arm-merge.mts`: under both
 * policies it requires green required checks, clean mergeability and current
 * `main` ancestry at arm time, and never arms a PR touching factory plumbing.
 * `approval` additionally waits for an authorized human's approval of the exact
 * head; `green` trusts the factory's review, gate and CI bar, as the owner
 * directs. Both exclude a delivery whose device/store evidence is pending.
 */
export type AutoMergePolicy = "approval" | "green";

/** The trust bar used when the host sets no `SANDCASTLE_AUTO_MERGE`. */
export const DEFAULT_AUTO_MERGE_POLICY = "green" satisfies AutoMergePolicy;

/** The label a delivery carries while its device/store evidence is pending. */
export const EVIDENCE_PENDING_LABEL = "device-evidence-pending";

function authorizedHuman(review: GithubReview): boolean {
  return (
    review.user.type === "User" &&
    !review.user.login.endsWith("[bot]") &&
    ["OWNER", "MEMBER", "COLLABORATOR"].includes(review.author_association)
  );
}

/**
 * A current approval counts only when it is the reviewer's latest substantive
 * decision and names the head being armed. COMMENTED reviews do not displace an
 * approval; CHANGES_REQUESTED and DISMISSED do.
 */
export function currentHumanApproval(
  reviews: readonly GithubReview[],
  head: string,
): boolean {
  const substantive = reviews.filter((review) =>
    ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
  );
  const latestByReviewer = new Map<string, GithubReview>();
  for (const review of substantive) {
    const prior = latestByReviewer.get(review.user.login);
    const newer =
      prior === undefined ||
      Date.parse(review.submitted_at) > Date.parse(prior.submitted_at) ||
      (review.submitted_at === prior.submitted_at && review.id > prior.id);
    if (newer) latestByReviewer.set(review.user.login, review);
  }
  return [...latestByReviewer.values()].some(
    (review) =>
      review.state === "APPROVED" &&
      review.commit_id === head &&
      authorizedHuman(review),
  );
}

/**
 * `approval` waits for an authorized human's approval of the unchanged head;
 * `green` accepts the factory's independent review, gate and CI bar alone.
 * The policy split is only one gate: `armMergeDecision` in `arm-merge.mts`
 * re-reads green required checks, clean mergeability and current-`main` ancestry
 * immediately before the exact-head call under either policy, and the green-CI
 * dispatch job runs that same trust bar seconds after CI succeeds. Checks and
 * mergeability are not deferred to GitHub at merge time — a red check or a
 * behind-base head waits. A pending-evidence delivery waits under either policy.
 */
export function autoMergeDecision(
  pr: FactoryPr,
  reviews: readonly GithubReview[],
  policy: AutoMergePolicy = DEFAULT_AUTO_MERGE_POLICY,
): AutoMergeDecision {
  if (!ownsFactoryPr(pr)) return { action: "wait", reason: "not an open factory PR" };
  if ((pr.labels ?? []).some((label) => label.name === EVIDENCE_PENDING_LABEL))
    return { action: "wait", reason: "device/store evidence is pending" };
  if (policy === "green") return { action: "arm" };
  if (!requiredChecksGreen(pr)) return { action: "wait", reason: "required checks not green" };
  if (pr.mergeable !== "MERGEABLE" || pr.mergeStateStatus !== "CLEAN")
    return { action: "wait", reason: "PR is not cleanly mergeable" };
  if (!currentHumanApproval(reviews, pr.headRefOid))
    return { action: "wait", reason: "no authorized human approval at this head" };
  return { action: "arm" };
}

export const AutoMergeState = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  autoMergeRequest: z
    .object({ mergeMethod: z.enum(["MERGE", "SQUASH", "REBASE"]) })
    .nullable(),
});
export type AutoMergeState = z.infer<typeof AutoMergeState>;

/** Success means merged already, or armed for the repository's linear-history merge method. */
export function autoMergeArmed(state: AutoMergeState): boolean {
  return (
    state.state === "MERGED" ||
    (state.state === "OPEN" && state.autoMergeRequest?.mergeMethod === "REBASE")
  );
}
