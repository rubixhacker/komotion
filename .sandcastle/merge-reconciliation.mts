import { z } from "zod";

const GitHubSha = z.string().regex(/^[0-9a-f]{40}$/);

/** A GitHub pull-request list entry used by merged factory reconciliation. */
export const MergedFactoryPr = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  headRefName: z.string(),
  headRefOid: GitHubSha,
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  mergedAt: z.string().nullable(),
  mergeCommit: z.object({ oid: GitHubSha }).nullable(),
  labels: z.array(z.object({ name: z.string() })),
  closingIssuesReferences: z.array(
    z.object({ number: z.number().int().positive() }),
  ),
});

export type MergedFactoryPr = z.infer<typeof MergedFactoryPr>;

/** Host-collected facts; the planner never runs Git, GitHub, or cleanup I/O. */
export interface MergeReconciliationContext {
  readonly localHead: string | null;
  readonly remoteHead: string | null;
  /** The host proved ancestry or git-cherry patch equivalence with main. */
  readonly landed: boolean;
  /** Another open pull request owns this exact branch. */
  readonly openPr: boolean;
  readonly issueOpen: boolean;
  readonly deviceEvidencePending: boolean;
  readonly worktreeDirty: boolean;
}

export interface MergeReconciliationPlan {
  /** The branch-derived issue, never an issue inferred from prose or links. */
  readonly issue: number | null;
  readonly mergeSha: string | null;
  readonly closeIssue: boolean;
  readonly cleanup: boolean;
  readonly reason: string;
}

const Sha = /^[0-9a-f]{40}$/;

function canonicalIssue(headRefName: string): number | null {
  const digits = /^sandcastle\/issue-(\d+)$/.exec(headRefName)?.[1];
  if (digits === undefined) return null;
  const issue = Number(digits);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

function blocker(
  pr: MergedFactoryPr,
  context: MergeReconciliationContext,
  issue: number | null,
  mergeSha: string | null,
): string | null {
  if (issue === null) return "branch is not an exact sandcastle/issue-N branch";
  if (pr.state !== "MERGED") return "pull request is not merged";
  if (pr.baseRefName !== "main") return "pull request does not target main";
  if (pr.isCrossRepository) return "pull request is cross-repository";
  if (mergeSha === null) return "merged pull request has no valid merge commit SHA";
  if (context.openPr) return "an open pull request still owns the branch";
  if (context.localHead !== null && context.localHead !== pr.headRefOid) {
    return "local branch head does not match the merged pull request";
  }
  if (context.remoteHead !== null && context.remoteHead !== pr.headRefOid) {
    return "remote branch head does not match the merged pull request";
  }
  if (!context.landed) return "the exact pull request head has no landed proof";
  if (context.worktreeDirty) return "worktree is dirty";
  return null;
}

/**
 * Plan issue closure and branch/worktree cleanup for one merged factory PR.
 *
 * Both actions fail closed unless every branch, head, landing, ownership, and
 * cleanliness check passes. Device evidence holds issue closure only; it does
 * not prevent cleanup of an otherwise exact, landed, clean branch.
 */
export function planMergeReconciliation(
  pr: MergedFactoryPr,
  context: MergeReconciliationContext,
): MergeReconciliationPlan {
  const issue = canonicalIssue(pr.headRefName);
  const candidateMergeSha = pr.mergeCommit?.oid ?? null;
  const mergeSha =
    candidateMergeSha !== null && Sha.test(candidateMergeSha)
      ? candidateMergeSha
      : null;
  const blocked = blocker(pr, context, issue, mergeSha);

  if (blocked !== null) {
    return {
      issue,
      mergeSha,
      closeIssue: false,
      cleanup: false,
      reason: blocked,
    };
  }

  if (!context.issueOpen) {
    return {
      issue,
      mergeSha,
      closeIssue: false,
      cleanup: true,
      reason: "issue is already closed; the exact landed head is safe to clean up",
    };
  }

  if (context.deviceEvidencePending) {
    return {
      issue,
      mergeSha,
      closeIssue: false,
      cleanup: true,
      reason: "device evidence is pending; keep the issue open and clean up the exact landed head",
    };
  }

  return {
    issue,
    mergeSha,
    closeIssue: true,
    cleanup: true,
    reason: "close the issue and clean up the exact landed head",
  };
}
