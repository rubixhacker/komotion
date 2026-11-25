import { INFLIGHT_LABEL, REPO } from "./queue.mjs";

/** The host command shape every factory adapter already receives. */
export type InFlightCommand = (program: string, args: readonly string[]) => string;

/** What the stale sweep reads from `gh issue list --label factory-inflight`. */
export interface LabelledIssue {
  readonly number: number;
  readonly state?: string | undefined;
}

const LABEL_COLOR = "1f6feb";

/**
 * Mark a ticket as actively worked. The label is created on demand so a fresh
 * repository can claim a ticket, and adding an existing label is a no-op.
 */
export function addInFlight(run: InFlightCommand, issue: number): void {
  run("gh", ["label", "create", INFLIGHT_LABEL, "--color", LABEL_COLOR, "--force"]);
  run("gh", [
    "issue",
    "edit",
    String(issue),
    "--repo",
    REPO,
    "--add-label",
    INFLIGHT_LABEL,
  ]);
}

/** Drop the claim when the worker is done, delivered or stopped. */
export function removeInFlight(run: InFlightCommand, issue: number): void {
  run("gh", [
    "issue",
    "edit",
    String(issue),
    "--repo",
    REPO,
    "--remove-label",
    INFLIGHT_LABEL,
  ]);
}

/**
 * Tickets whose claim label is no longer backed by a worker or a retained
 * branch. `branches` is the text `branchSnapshot()` returns: one local or
 * `origin/`-prefixed branch per line. A closed issue needs no label once its
 * worker has stopped, even when its branch lingers: the work is delivered.
 */
export function staleInFlight(
  labelled: readonly LabelledIssue[],
  active: ReadonlySet<number>,
  branches: string,
): number[] {
  const retained = new Set<number>();
  for (const line of branches.split("\n")) {
    const match = /(?:^|\/)sandcastle\/issue-(\d+)(?:\D|$)/.exec(line.trim());
    if (match?.[1] !== undefined) retained.add(Number(match[1]));
  }
  return labelled
    .filter(
      (issue) =>
        !active.has(issue.number) &&
        (issue.state === "CLOSED" || !retained.has(issue.number)),
    )
    .map((issue) => issue.number);
}

/**
 * The label lifecycle for one factory process. `active` is the worker-side
 * truth the stale sweep reads; GitHub is the visible side. Author, resume and
 * repair workers all claim here, so a crash leaves only GitHub's copy behind
 * for the sweep to clear.
 */
export interface FlightMarks {
  readonly active: ReadonlySet<number>;
  claim(issue: number): void;
  release(issue: number): void;
  /** A deliberate factory stop releases every claim it still owns. */
  releaseAll(): void;
  stale(labelled: readonly LabelledIssue[], branches: string): number[];
}

export function flightMarks(run: InFlightCommand): FlightMarks {
  const active = new Set<number>();
  return {
    active,
    claim(issue) {
      addInFlight(run, issue);
      active.add(issue);
    },
    release(issue) {
      removeInFlight(run, issue);
      active.delete(issue);
    },
    releaseAll() {
      for (const issue of active) removeInFlight(run, issue);
      active.clear();
    },
    stale(labelled, branches) {
      return staleInFlight(labelled, active, branches);
    },
  };
}
