/**
 * The body of a ticket's delivery pull request. The first line carries a
 * GitHub closing keyword so a merged PR closes its issue on GitHub itself;
 * the factory's merge reconciliation is only a backstop, and it fails closed
 * on a moved or dirty branch and skips heads it does not own. A body that
 * only mentions the issue leaves it open, and the factory reads an open
 * ready ticket no open PR names as free work.
 */
export interface DeliveryBodyOptions {
  readonly issue: number;
  readonly base: string;
  readonly head: string;
  readonly pendingBanner: string;
  readonly lintNote: string | null;
  readonly swiftNote: string | null;
  readonly authorModel: string;
  readonly reviewerModel: string;
  readonly deliveryNotes: string;
}

export function deliveryBody(options: DeliveryBodyOptions): string {
  const {
    issue,
    base,
    head,
    pendingBanner,
    lintNote,
    swiftNote,
    authorModel,
    reviewerModel,
    deliveryNotes,
  } = options;
  return `Closes #${issue}.\n\n${pendingBanner}Base: ${base}\nHead: ${head}\n\nIndependent OpenCode review passed; qualityGate passed.${lintNote === null ? "" : `\nSwift lint: ${lintNote}.`}${swiftNote === null ? "" : `\nSwift compile: ${swiftNote}.`}\nAuthor model: ${authorModel}; reviewer model: ${reviewerModel}.\n\n${deliveryNotes}\n`;
}
