/**
 * When a ticket branch resumes, the factory starts a fresh agent session: a
 * long OpenCode session carries the earlier run's wrong assumptions as well as
 * its decisions, and resuming it is brittle across model and CLI upgrades.
 * Instead, hand the new agent structured evidence from the earlier run.
 */
export interface ResumeBrief {
  /** The retained head the resumed run continues. */
  readonly head: string;
  /** The pass's base commit. */
  readonly base: string;
  /** One-line commit subjects already on the branch, newest first. */
  readonly commits: readonly string[];
  /** Prior failed attempts for this ticket, in ledger order. */
  readonly strikes: readonly {
    readonly kind: string;
    readonly detail: string;
  }[];
  /** Whether the prior run's delivery.md was copied into the worktree. */
  readonly hasDeliveryNotes: boolean;
}

export function resumeBriefText(input: ResumeBrief): string {
  const lines = [
    `This branch already holds committed work from an interrupted run (${input.head.slice(0, 7)}).`,
    `Review its diff against the merge base with ${input.base.slice(0, 7)}: finish what is missing or broken, do not redo completed work or rewrite history.`,
  ];
  if (input.hasDeliveryNotes) {
    lines.push(
      "",
      "Read .sandcastle/delivery.md from the earlier run before changing code. It records the acceptance criteria, the decisions behind the current implementation, the commands already run and the limitations they recorded. Treat it as evidence to verify against the code, not as proof that the work is correct.",
    );
  }
  if (input.commits.length > 0) {
    lines.push("", "Commits already on this branch:", ...input.commits.map((c) => `- ${c}`));
  }
  if (input.strikes.length > 0) {
    lines.push(
      "",
      "Why earlier attempts failed:",
      ...input.strikes.map((s) => `- ${s.kind}: ${s.detail}`),
    );
    lines.push(
      "",
      "Do not repeat a failed approach: address the reason above, then verify the result with the repository's own checks.",
    );
  }
  return lines.join("\n");
}
