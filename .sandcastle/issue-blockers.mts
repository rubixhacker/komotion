import { z } from "zod";

/**
 * A blocker's live state as GitHub reports it on a native issue dependency.
 * The dependencies endpoint returns lowercase `open`/`closed`, while
 * `gh issue view` uses uppercase; both are normalized to one value.
 */
export const BlockerState = z
  .enum(["open", "closed", "OPEN", "CLOSED"])
  .transform((state): "open" | "closed" => (state.toLowerCase() === "open" ? "open" : "closed"));
export type BlockerState = z.infer<typeof BlockerState>;

/**
 * One native "blocked by" edge: the blocking issue's identity and live state.
 * Only these three fields travel into the snapshot. The REST response also
 * carries a body, which is deliberately ignored so no blocker is ever inferred
 * from prose in an issue body.
 */
export const BlockedByEdge = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: BlockerState,
});
export type BlockedByEdge = z.infer<typeof BlockedByEdge>;

export const BlockedByEdges = z.array(BlockedByEdge);

/** The credentialed, host-side `gh` reader the factory injects. */
export type GhJsonReader = (args: readonly string[]) => string;

/**
 * Every native "blocked by" edge GitHub records for an issue.
 *
 * The dependency endpoint is paged; `--slurp` collects its pages into an array
 * of arrays. An issue with no dependencies returns an empty page, which
 * flattens to no edges.
 */
export function fetchBlockedBy(
  read: GhJsonReader,
  repo: string,
  issue: number,
): BlockedByEdge[] {
  const pages = z.array(BlockedByEdges).parse(
    JSON.parse(
      read([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/issues/${issue}/dependencies/blocked_by`,
      ]),
    ),
  );
  return pages.flat();
}

/**
 * The `blockedBy` field written into an issue snapshot and the planner context
 * file. Only the three native fields are carried, so a body that says
 * "Blocked by #N" in prose can never masquerade as a native edge.
 */
export function serializeBlockedBy(edges: readonly BlockedByEdge[]): BlockedByEdge[] {
  return edges.map(({ number, title, state }) => ({ number, title, state }));
}

/** The edges that still hold an issue: a closed dependency no longer blocks. */
export function openBlockers(edges: readonly BlockedByEdge[]): BlockedByEdge[] {
  return edges.filter((edge) => edge.state === "open");
}

/** A one-line diagnostic of an issue's blockers, with each blocker's live state. */
export function describeBlockedBy(issue: number, edges: readonly BlockedByEdge[]): string {
  if (edges.length === 0) return `#${issue}: no native blockers`;
  const listed = edges
    .map((edge) => `#${edge.number} "${edge.title}" (${edge.state})`)
    .join(", ");
  return `#${issue} blocked by ${listed}`;
}
