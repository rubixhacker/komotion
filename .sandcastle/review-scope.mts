/**
 * What a review is shown and asked.
 *
 * A ticket's branch is reviewed whole, against its base. A repair committed on
 * top of a delivered commit is reviewed alone, against that commit: the whole
 * branch passed a review there already, and a second whole review is a second
 * draw that fails a sound repair for something the first let through.
 */
export interface ReviewScope {
  /** The `git diff` range written to `review.diff`. */
  readonly range: string;
  /** The prompt file, relative to `.sandcastle/`. */
  readonly prompt: string;
  readonly promptArgs: Readonly<Record<string, string>>;
}

export function reviewScope(base: string, branch: string, reviewedHead: string | null): ReviewScope {
  if (reviewedHead === null)
    return { range: `${base}...${branch}`, prompt: "review-prompt.md", promptArgs: {} };
  return {
    // Two dots: exactly what the repair added to the reviewed commit.
    range: `${reviewedHead}..${branch}`,
    prompt: "repair-review-prompt.md",
    promptArgs: { REVIEWED_HEAD: reviewedHead },
  };
}
