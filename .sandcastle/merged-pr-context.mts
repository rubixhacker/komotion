import { z } from "zod";

/**
 * The part of a merged pull request an implement run needs to recognise prior
 * work. The sandbox has no GitHub credential, so the host reads this from
 * GitHub and hands it to the agent in the issue-context file.
 */
export const MergedPrRef = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  mergedAt: z.string().nullable(),
  closingIssuesReferences: z.array(
    z.object({ number: z.number().int().positive() }),
  ),
});
export type MergedPrRef = z.infer<typeof MergedPrRef>;

export const MergedPrRefs = z.array(MergedPrRef);

/**
 * Merged pull requests that mention an issue. GitHub only records a closing
 * reference when a fix lands with a closing keyword; the motivating case (#2308
 * for #2262) merged with a reference-style title while the issue stayed open,
 * leaving no closing reference. A reference in the title or body is therefore
 * a candidate too, and the implement run verifies which candidate covers the
 * ticket. This repository rebase-merges, so neither a merge commit nor a
 * commit message carries the PR number.
 */
export function mergedPrsForIssue(
  prs: readonly MergedPrRef[],
  issue: number,
): MergedPrRef[] {
  const reference = new RegExp(`(?:#|/issues/)${issue}(?![0-9])`);
  return prs.filter(
    (pr) =>
      pr.state === "MERGED" &&
      (reference.test(pr.title) ||
        reference.test(pr.body) ||
        pr.closingIssuesReferences.some((ref) => ref.number === issue)),
  );
}

/** A short, deterministic rendering the implement run quotes as its evidence. */
export function formatMergedPrs(
  prs: readonly MergedPrRef[],
  issue: number,
): string {
  if (prs.length === 0) return `No merged pull request references #${issue}.`;
  const lines = prs.map(
    (pr) =>
      `- PR #${pr.number} "${pr.title}" (${pr.url}) references #${issue}.`,
  );
  return [`Merged pull requests mentioning #${issue}:`, ...lines].join("\n");
}
