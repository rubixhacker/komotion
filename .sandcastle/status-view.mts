import { ownsFactoryPr } from "./factory-ci.mjs";
import type { ListedFactoryPr } from "./factory-prs.mjs";
import { summarizeChecks } from "./fleet.mjs";
import { describeStatus, statusIsStale, type FactoryStatus } from "./status.mjs";

/**
 * The single wide view of the factory: the current pass and its in-flight
 * tickets, the retained branches still waiting to be resumed, and the check
 * state of the open delivery pull requests. An operator reads this instead of
 * cross-checking the status file, the branch ledger and the pull request list.
 *
 * The view is pure: the command collects each section and hands it here, so a
 * section that could not be read is reported as such rather than hiding the
 * others, and the whole report is testable without a checkout or a GitHub call.
 */

/** A local ticket branch that still holds commits the factory could resume. */
export interface ResumableBranch {
  /** The issue the branch belongs to. */
  readonly issue: number;
  /** Local branch name, e.g. `sandcastle/issue-1933`. */
  readonly branch: string;
  /** Short commit hash of the branch head. */
  readonly head: string;
  /** That head already spent the one resume the factory allows. */
  readonly resumeExhausted: boolean;
}

export interface FactoryViewInput {
  /** `null` when no pass has run, `"unreadable"` when its file could not be read. */
  readonly status: FactoryStatus | null | "unreadable";
  /** `null` when the local branches or the resume ledger could not be read. */
  readonly resumable: readonly ResumableBranch[] | null;
  /** `null` when the open pull requests could not be listed. */
  readonly pullRequests: readonly ListedFactoryPr[] | null;
}

const MAX_BRANCH_LINES = 10;
const MAX_PR_LINES = 10;

/** Issue numbers the status file already reports as in flight. */
function inFlightIssues(status: FactoryStatus | null | "unreadable"): ReadonlySet<number> {
  if (status === null || status === "unreadable") return new Set();
  const numbers = Object.keys(status.tickets ?? {}).map(Number);
  // A single-ticket pass records its work in `ticket`, not in `tickets`.
  if (status.ticket !== null) numbers.push(status.ticket);
  return new Set(numbers);
}

/**
 * The whole view, with one section per question an operator asks. A branch
 * whose ticket is in flight is deliberately left out of the resumable section:
 * it is actively worked, not one merely held by a stale branch.
 */
export function describeFactoryView(input: FactoryViewInput, now: Date): string {
  const lines: string[] = ["factory status:"];

  lines.push("  pass:");
  if (input.status === null) lines.push("    (no pass has recorded a status)");
  else if (input.status === "unreadable") lines.push("    (unreadable)");
  else
    lines.push(
      ...describeStatus(input.status, now)
        .split("\n")
        .map((line) => `    ${line}`),
    );

  lines.push("  resumable branches:");
  if (input.resumable === null) lines.push("    (unreadable)");
  else {
    const inFlight = inFlightIssues(input.status);
    const waiting = input.resumable.filter((branch) => !inFlight.has(branch.issue));
    const resumable = waiting.filter((branch) => !branch.resumeExhausted);
    const exhausted = waiting.filter((branch) => branch.resumeExhausted);
    if (resumable.length === 0 && exhausted.length === 0) lines.push("    (none)");
    else {
      for (const branch of resumable.slice(0, MAX_BRANCH_LINES))
        lines.push(`    #${branch.issue} ${branch.branch} ${branch.head} — retained, not in flight`);
      if (resumable.length > MAX_BRANCH_LINES)
        lines.push(`    ${resumable.length - MAX_BRANCH_LINES} more resumable branches`);
      for (const branch of exhausted.slice(0, MAX_BRANCH_LINES))
        lines.push(
          `    #${branch.issue} ${branch.branch} ${branch.head} — resume already used, needs a human`,
        );
      if (exhausted.length > MAX_BRANCH_LINES)
        lines.push(`    ${exhausted.length - MAX_BRANCH_LINES} more branches past their resume`);
    }
  }

  lines.push("  delivery pull requests:");
  if (input.pullRequests === null) lines.push("    (unreadable)");
  else {
    const factory = input.pullRequests.filter(ownsFactoryPr);
    const shown = factory.slice(0, MAX_PR_LINES);
    if (shown.length === 0) lines.push("    (no open factory pull requests)");
    else
      for (const pr of shown)
        lines.push(`    #${pr.number} ${pr.title}: ${summarizeChecks(pr)}`);
    if (factory.length > shown.length)
      lines.push(`    ${factory.length - shown.length} more open factory pull requests`);
  }

  return lines.join("\n");
}

/**
 * The stale-status error a health probe reports, or null when the pass is
 * healthy. Kept pure so the stale path is tested without running the command.
 */
export function staleStatusError(
  status: FactoryStatus | null | "unreadable",
  now: Date,
  maxIdleMinutes: number,
): string | null {
  if (status === null || status === "unreadable") return null;
  if (!statusIsStale(status, now, maxIdleMinutes * 60_000)) return null;
  return `The pass has not updated for over ${maxIdleMinutes} minutes; check systemctl --user status sandcastle-factory.service`;
}

/** Exit 1 for a stale pass or a finished pass that ended in error, else 0. */
export function factoryViewExitCode(
  status: FactoryStatus | null | "unreadable",
  now: Date,
  maxIdleMinutes: number,
): number {
  if (status === null || status === "unreadable") return 0;
  if (staleStatusError(status, now, maxIdleMinutes) !== null) return 1;
  return status.finishedAt !== null && status.error !== null ? 1 : 0;
}
