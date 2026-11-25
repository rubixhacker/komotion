import { z } from "zod";
import { type BlockedByEdge, BlockedByEdges, openBlockers } from "./issue-blockers.mjs";

export const REPO = "rubixhacker/komotion";
/**
 * Derived, informational label showing that a factory worker (author, repair or
 * resume) is working on a ticket. It never replaces branch-based ownership or
 * the strike ledger. See `factory-inflight.mts` for its lifecycle.
 */
export const INFLIGHT_LABEL = "factory-inflight";
export const Issue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  /** When the issue last changed; a planner decline stands until this or main moves. */
  updatedAt: z.string().optional(),
  /**
   * A main commit that names this issue after it was last labelled
   * ready-for-agent. The host sets it in `snapshot()`; GitHub never sends it.
   */
  mainlineMention: z.string().optional(),
  /**
   * Native "blocked by" edges the host read from GitHub. The source of truth
   * for eligibility: prose in the body never becomes one, so a `Blocked by:`
   * line alone cannot hold an issue. Absent for tickets read before blockers
   * were exposed and in tests that do not exercise dependencies.
   */
  blockedBy: BlockedByEdges.optional(),
});
export const Issues = z.array(Issue);
export const PullRequests = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    headRefName: z.string(),
    closingIssuesReferences: z
      .array(z.object({ number: z.number().int().positive() }))
      .optional(),
  }),
);
export type Ticket = z.infer<typeof Issue>;
export type PullRequest = z.infer<typeof PullRequests>[number];
export const CompletedIssue = z.object({
  id: z.number().int().positive(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  reason: z.string().min(1),
});
export type CompletedTicket = z.infer<typeof CompletedIssue>;
export const DeclinedIssue = z.object({
  id: z.number().int().positive(),
  reason: z.string().default(""),
  /**
   * "owner-decision" when the ticket's own text leaves a product decision
   * open, or "out-of-sandbox" when its named target lives outside the factory
   * sandbox. Anything else the planner writes here is an ordinary decline.
   */
  needs: z.string().optional().catch(undefined),
});
export const Plan = z.object({
  completed: z.array(CompletedIssue).default([]),
  /** Candidates the planner looked at and did not select, each with its reason. */
  declined: z.array(DeclinedIssue).default([]),
  issues: z.array(
    z.object({
      id: z.number().int().positive(),
      title: z.string(),
    }),
  ),
});

/**
 * Labels that keep an otherwise-ready ticket out of the factory's queue.
 * `device-evidence-pending` marks work only a device-capable local session can
 * finish, so the sandbox never picks it up even when it is `ready-for-agent`.
 */
const HOLDING_LABELS = [
  "ready-for-human",
  "needs-info",
  "needs-triage",
  "release-watch",
  "device-evidence-pending",
  // A ticket the factory gave up on, for the owner to run in an interactive agent session.
  "ready-for-interactive-agent",
  // A stale claim left by a crashed factory holds the ticket until the stale
  // sweep clears it, so no second worker picks it up. A live claim is ignored
  // by `retained()` and `releaseReason()` below: the label is informational.
  INFLIGHT_LABEL,
] as const;

/**
 * A mainline commit closes an issue only when it uses a GitHub closing keyword.
 * A bare `#N` mention is not evidence the work is done.
 */
export function commitClosesIssue(message: string, id: number): boolean {
  return new RegExp(
    `\\b(?:fix(?:es|ed)?|close[sd]?|resolv(?:e|es|ed))\\s*:?\\s+#${id}(?![0-9])`,
    "i",
  ).test(message);
}

/** A commit message names the issue: `#N` or an issue URL, not a longer number. */
export function mentionsIssue(message: string, id: number): boolean {
  return new RegExp(`(?:#|/issues/)${id}(?![0-9])`).test(message);
}

export interface MainCommit {
  readonly sha: string;
  /** Committer time in Unix seconds; a rebase merge stamps the merge time. */
  readonly time: number;
  readonly message: string;
}

/**
 * The newest main commit naming each issue after the issue last became ready.
 *
 * Work can land on main without closing its issue: an integration PR that
 * names none of the issues it delivers leaves every one of them open and
 * ready, and the factory builds them a second time. A mention is not proof the
 * work is done, so the issue is held for a human, not closed. Labelling it
 * ready-for-agent again moves `readySince` past the mention and releases it.
 * `couldDeliver` is asked only about commits that name an issue, so the host
 * can skip documentation-only commits without listing every commit's files.
 */
export function mainlineMentions(
  readySince: ReadonlyMap<number, number>,
  commits: readonly MainCommit[],
  couldDeliver: (commit: MainCommit) => boolean = () => true,
): Map<number, string> {
  const found = new Map<number, string>();
  for (const [id, since] of readySince) {
    const commit = commits.find(
      (candidate) =>
        candidate.time > since &&
        mentionsIssue(candidate.message, id) &&
        couldDeliver(candidate),
    );
    if (commit !== undefined) found.set(id, commit.sha);
  }
  return found;
}

/**
 * A path that only documents: anything under `docs/`, or a Markdown file
 * outside `.sandcastle/` and `.claude/`, where Markdown is agent prompts and
 * skills that change behaviour.
 */
export function isDocumentationPath(path: string): boolean {
  if (path.startsWith("docs/")) return true;
  if (path.startsWith(".sandcastle/") || path.startsWith(".claude/")) return false;
  return /\.mdx?$/i.test(path);
}

/**
 * Whether a commit touching these paths could deliver an issue's work. A
 * commit that changes only documentation, such as a decision record whose
 * footer says `Refs #N`, cannot; a commit with no paths stays suspect.
 */
/** Paths that change the factory or CI itself, never a product ticket's work. */
function isFactoryInfrastructurePath(path: string): boolean {
  return (
    path.startsWith(".sandcastle/") ||
    path.startsWith(".github/") ||
    path.startsWith("scripts/ci/") ||
    path === "CLAUDE.md" ||
    path === "AGENTS.md"
  );
}

export function couldDeliverWork(paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return !paths.every((path) => isDocumentationPath(path) || isFactoryInfrastructurePath(path));
}

/** Why a main commit's mention holds an issue, worded once for the report. */
export function mentionBlocker(sha: string): string {
  return `named by main commit ${sha.slice(0, 9)} since it was made ready; label it ready-for-agent again if work remains`;
}

/**
 * Why a native dependency still holds a ticket, or null when none is open.
 *
 * Only GitHub's dependency edges count: a `Blocked by:` line in prose is never
 * parsed, so prose and native edges can coexist during the transition without
 * holding an issue twice. A closed edge no longer holds it at all, which makes
 * a ticket eligible as soon as its last blocker closes, with no label edit.
 */
export function nativeBlocker(issue: Ticket): string | null {
  const open = openBlockers(issue.blockedBy ?? []);
  if (open.length === 0) return null;
  return `blocked by ${open
    .map((edge: BlockedByEdge) => `#${edge.number} "${edge.title}" (open)`)
    .join(", ")}`;
}

/** Why an existing ticket branch excludes its issue, worded once for the report and the retry. */
export function branchBlocker(number: number): string {
  return `branch sandcastle/issue-${number} exists`;
}

/**
 * The branch names ownership is read from: every local branch, and the
 * Sandcastle branches that exist on the remote right now.
 *
 * `git branch -a` is not that list. It includes remote-tracking refs, and the
 * factory only ever fetches main, so a tracking ref for a ticket branch
 * outlives the branch: delete `sandcastle/issue-N` on GitHub and the stale
 * `origin/sandcastle/issue-N` kept its ticket out of the queue for good.
 */
export function branchSnapshot(localBranches: string, lsRemoteHeads: string): string {
  const remote = lsRemoteHeads
    .split("\n")
    .flatMap((line) => {
      const ref = /^[0-9a-f]{40}\s+refs\/heads\/(\S+)$/.exec(line.trim())?.[1];
      return ref === undefined ? [] : [`origin/${ref}`];
    });
  return [...localBranches.split("\n").filter(Boolean), ...remote].join("\n");
}

/**
 * Why this ticket is not available to the factory, or null when it is.
 *
 * `queue()` and the held-back report both read this, so the reason printed for
 * an unavailable ticket is the exact condition that excluded it.
 */
export function eligibilityBlocker(
  issue: Ticket,
  prs: readonly PullRequest[],
  branches: string,
  options: { readonly ignoreInFlight?: boolean } = {},
): string | null {
  const labels = issue.labels
    .map((label) => label.name)
    .filter((name) => !(options.ignoreInFlight === true && name === INFLIGHT_LABEL));
  if (!labels.includes("ready-for-agent")) return "not labelled ready-for-agent";
  const holding = HOLDING_LABELS.find((label) => labels.includes(label));
  if (holding !== undefined) return `held by ${holding}`;
  const blocker = nativeBlocker(issue);
  if (blocker !== null) return blocker;
  if (issue.mainlineMention !== undefined) return mentionBlocker(issue.mainlineMention);
  const reference = new RegExp(`(?:#|/issues/)${issue.number}(?![0-9])`);
  const branch = new RegExp(`sandcastle/issue-${issue.number}(?:\\D|$)`);
  const owner = prs.find(
    (pr) =>
      pr.closingIssuesReferences?.some((link) => link.number === issue.number) ||
      reference.test(pr.body) ||
      reference.test(pr.title) ||
      branch.test(pr.headRefName),
  );
  if (owner !== undefined) return `claimed by PR #${owner.number}`;
  if (branch.test(branches)) return branchBlocker(issue.number);
  return null;
}

/**
 * Tickets whose earlier factory run committed work but never delivered it: the
 * branch exists, yet no PR and no hold label owns the issue. `queue()` excludes
 * them as branch-owned; the pass resumes these so the commits are not stranded.
 */
export function retained(
  issues: readonly Ticket[],
  prs: readonly PullRequest[],
  branches: string,
): readonly Ticket[] {
  return issues.filter(
    (issue) =>
      eligibilityBlocker(issue, prs, branches, { ignoreInFlight: true }) ===
      branchBlocker(issue.number),
  );
}


export function queue(
  issues: readonly Ticket[],
  prs: readonly PullRequest[],
  branches: string,
) {
  return issues.filter(
    (issue) => eligibilityBlocker(issue, prs, branches) === null,
  );
}

/**
 * Why the factory should stop working on a ticket it already started, or null
 * while the ticket is still its own.
 *
 * `issues` is the open `ready-for-agent` list, so a ticket missing from it was
 * closed or relabelled. Branches are not read: the ticket's own branch is what
 * the factory is working on. On 14 November another session delivered #2221
 * while the factory was repairing it, and the factory worked on for 70 minutes.
 */
export function releaseReason(
  number: number,
  issues: readonly Ticket[],
  prs: readonly PullRequest[],
): string | null {
  const issue = issues.find((candidate) => candidate.number === number);
  if (issue === undefined) return "the issue is closed or no longer labelled ready-for-agent";
  // The worker's own claim label is not a reason to release it: only the
  // ticket's actual eligibility (closed, held, or claimed by another PR) is.
  return eligibilityBlocker(issue, prs, "", { ignoreInFlight: true });
}

export interface HeldBackTicket {
  readonly number: number;
  readonly title: string;
  readonly reason: string;
}

/** The complementary list: every ticket the queue skipped, and the condition that skipped it. */
export function heldBack(
  issues: readonly Ticket[],
  prs: readonly PullRequest[],
  branches: string,
): HeldBackTicket[] {
  return issues.flatMap((issue) => {
    const reason = eligibilityBlocker(issue, prs, branches);
    return reason === null
      ? []
      : [{ number: issue.number, title: issue.title, reason }];
  });
}

/** The reason recorded for a candidate the planner's answer never mentioned. */
export const UNEXPLAINED_DECLINE =
  "the planner returned no decision or reason for this ticket";

export interface DeclinedTicket {
  readonly number: number;
  readonly reason: string;
  /** The ticket waits on a decision only the owner can make; no later pass can do better. */
  readonly ownerDecision: boolean;
  /** The ticket's named target is outside the sandbox, so an interactive agent must do it. */
  readonly outOfSandbox: boolean;
}

/**
 * Read the planner's answer against the candidates it was given.
 *
 * Every candidate comes back in exactly one list: selected, completed or
 * declined. A candidate the planner did not mention is declined with
 * `UNEXPLAINED_DECLINE`, so an empty plan is never silent: each ticket it
 * passed over is on record with a reason the host can count and report.
 */
export function parsePlan(
  stdout: string,
  candidates: readonly Ticket[],
  limit: number,
) {
  const match = /<plan>([\s\S]*?)<\/plan>/.exec(stdout);
  if (match === null)
    throw new FactoryError("The planner returned no <plan> block");
  let json: unknown;
  try {
    json = JSON.parse(match[1] ?? "");
  } catch {
    throw new FactoryError("The planner's <plan> block is not valid JSON");
  }
  const plan = Plan.parse(json);
  const ids = new Set<number>();
  for (const completed of plan.completed) {
    if (
      !candidates.some((ticket) => ticket.number === completed.id) ||
      ids.has(completed.id)
    )
      throw new FactoryError(
        `Planner selected ineligible/duplicate completed issue ${completed.id}`,
      );
    ids.add(completed.id);
  }
  const issues = plan.issues.map((planned) => {
    const ticket = candidates.find(
      (candidate) => candidate.number === planned.id,
    );
    if (!ticket || ids.has(planned.id))
      throw new FactoryError(
        `Planner selected ineligible/duplicate issue ${planned.id}`,
      );
    ids.add(planned.id);
    return ticket;
  });
  // A decline cannot dispatch anything, so a stray or contradictory entry is
  // dropped instead of failing the plan: selection wins over a decline.
  const reasons = new Map<number, string>();
  const ownerDecisions = new Set<number>();
  const outOfSandbox = new Set<number>();
  for (const declined of plan.declined) {
    if (ids.has(declined.id) || reasons.has(declined.id)) continue;
    if (!candidates.some((ticket) => ticket.number === declined.id)) continue;
    reasons.set(declined.id, declined.reason.trim());
    // Without a reason there is nothing to post on the issue, so it stays a decline.
    if (declined.needs === "owner-decision" && declined.reason.trim() !== "")
      ownerDecisions.add(declined.id);
    if (declined.needs === "out-of-sandbox" && declined.reason.trim() !== "")
      outOfSandbox.add(declined.id);
  }
  const declined: DeclinedTicket[] = candidates
    .filter((ticket) => !ids.has(ticket.number))
    .map((ticket) => ({
      number: ticket.number,
      reason: reasons.get(ticket.number) || UNEXPLAINED_DECLINE,
      ownerDecision: ownerDecisions.has(ticket.number),
      outOfSandbox: outOfSandbox.has(ticket.number),
    }));
  return {
    issues: issues.slice(0, limit),
    completed: plan.completed,
    declined,
    // Selected, but beyond this pass's cap: not a decline, just not yet.
    overflow: issues.slice(limit),
  };
}

export class FactoryError extends Error {}
