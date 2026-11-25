import { z } from "zod";

export const Check = z.object({
  __typename: z.enum(["CheckRun", "StatusContext"]),
  name: z.string().optional(),
  context: z.string().optional(),
  workflowName: z.string().nullable().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().optional(),
  detailsUrl: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
});
export const DependabotPr = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }),
  headRefName: z.string(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  mergeable: z.enum(["UNKNOWN", "MERGEABLE", "CONFLICTING"]),
  mergeStateStatus: z.string(),
  statusCheckRollup: z.array(Check).nullable(),
});
export type BotPr = z.infer<typeof DependabotPr>;
export type PrCheck = z.infer<typeof Check>;

export const EXPECTED_CHECKS = [
  ["CI", "Lint & Code Quality"],
  ["CI", "android-build"],
  ["iOS PR Checks", "iOS Quick Build Check"],
] as const;
const IOS_QUICK_CHECK = EXPECTED_CHECKS[2];
// iOS PR Checks skips its quick check when the PR touches no iOS-relevant path. That skip counts
// as passing only beside a successful classifier run; any other skip stays unpassed.
const IOS_CHANGE_DETECTOR = [
  "iOS PR Checks",
  "Detect iOS-relevant changes",
] as const;

export const MAX_REPAIR_ATTEMPTS = 3;
/**
 * Repair runs one pull request gets in its lifetime, whatever main does.
 *
 * The per-base budget alone never ends: main moves several times a day, and
 * each move hands a pull request three more runs. One update that could not be
 * repaired got nine runs over three bases in sixteen hours, each leaving a
 * branch behind, and nobody was told.
 */
export const MAX_REPAIR_ATTEMPTS_PER_PR = 6;

/**
 * Repair budget for one main base. A repair push produces a new head, so
 * counting per head would hand out a fresh budget on every push and let a
 * recurring failure repair forever.
 */
export function repairAttempts(
  prior: { readonly base: string; readonly attempts: number } | undefined,
  base: string,
) {
  return prior?.base === base ? prior.attempts : 0;
}

export interface RepairBudget {
  /** Repair runs spent on the current main base. */
  readonly onBase: number;
  /** Repair runs spent on this pull request since it was opened. */
  readonly total: number;
  /** Which budget is spent, or null when another repair may start. */
  readonly exhausted: "pull-request" | "base" | null;
}

/**
 * What a pull request has spent and whether it may be repaired again. The
 * lifetime budget is checked first: once it is gone, a new base changes
 * nothing and the pull request needs a human.
 */
export function repairBudget(
  prior:
    | { readonly base: string; readonly attempts: number; readonly total?: number | undefined }
    | undefined,
  base: string,
): RepairBudget {
  const onBase = repairAttempts(prior, base);
  // A ledger entry written before the lifetime count existed has only `attempts`.
  const total = Math.max(prior?.total ?? 0, prior?.attempts ?? 0);
  return {
    onBase,
    total,
    exhausted:
      total >= MAX_REPAIR_ATTEMPTS_PER_PR
        ? "pull-request"
        : onBase >= MAX_REPAIR_ATTEMPTS
          ? "base"
          : null,
  };
}

/** The number in a repair attempt branch, `sandcastle/dependabot-<pr>-<head>-<time>`. */
const ATTEMPT_BRANCH = /^sandcastle\/dependabot-(\d+)-[0-9a-f]+-\d+$/;

/**
 * Repair attempt branches to delete: those whose pull request is no longer
 * open. Every failed repair keeps its branch as evidence, which is worth
 * having only while the pull request can still be repaired; twenty of them had
 * collected for pull requests merged or closed weeks earlier.
 */
export function staleAttemptBranches(
  branches: readonly string[],
  openPrs: ReadonlySet<number>,
  checkedOut: ReadonlySet<string>,
): string[] {
  return branches.filter((branch) => {
    const number = ATTEMPT_BRANCH.exec(branch)?.[1];
    return (
      number !== undefined && !openPrs.has(Number(number)) && !checkedOut.has(branch)
    );
  });
}

/**
 * Deadline for one watchdog pass. Queued GitHub events extend the pass while
 * work is arriving, but never beyond the pass cap, so a steady event stream
 * cannot keep one pass alive indefinitely.
 */
export function passDeadline(
  startedAt: number,
  now: number,
  runMinutes: number,
  maxPassMinutes: number,
) {
  return Math.min(
    now + runMinutes * 60_000,
    startedAt + maxPassMinutes * 60_000,
  );
}

export function failure(check: PrCheck) {
  return [
    "FAILURE",
    "ERROR",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
  ].includes(check.conclusion ?? check.state ?? "");
}
export function eligible(pr: BotPr) {
  return (
    pr.state === "OPEN" &&
    pr.author.is_bot &&
    pr.author.login === "app/dependabot" &&
    pr.headRefName.startsWith("dependabot/") &&
    pr.baseRefName === "main" &&
    !pr.isDraft &&
    !pr.isCrossRepository
  );
}

function completedAs(
  checks: readonly PrCheck[],
  [workflow, name]: readonly [string, string],
  conclusion: string,
) {
  return checks.some(
    (check) =>
      check.workflowName === workflow &&
      check.name === name &&
      check.status === "COMPLETED" &&
      check.conclusion === conclusion,
  );
}

function isIosQuickCheck(check: PrCheck) {
  return (
    check.workflowName === IOS_QUICK_CHECK[0] &&
    check.name === IOS_QUICK_CHECK[1]
  );
}

export function green(pr: Pick<BotPr, "statusCheckRollup">) {
  const checks = pr.statusCheckRollup ?? [];
  const iosSkipAllowed = completedAs(checks, IOS_CHANGE_DETECTOR, "SUCCESS");
  return (
    EXPECTED_CHECKS.every(
      (expected) =>
        completedAs(checks, expected, "SUCCESS") ||
        (iosSkipAllowed &&
          expected === IOS_QUICK_CHECK &&
          completedAs(checks, expected, "SKIPPED")),
    ) &&
    checks.every((check) => {
      if (check.__typename === "StatusContext")
        return check.state === "SUCCESS";
      if (check.status !== "COMPLETED") return false;
      if (check.conclusion === "SUCCESS") return true;
      return (
        check.conclusion === "SKIPPED" &&
        ((iosSkipAllowed && isIosQuickCheck(check)) ||
          (check.workflowName === "Site" && check.name === "deploy"))
      );
    })
  );
}
export function decide(pr: BotPr, upToDate: boolean) {
  if (!eligible(pr)) return "ignore";
  if (pr.mergeable === "CONFLICTING") return "repair";
  const failed = (pr.statusCheckRollup ?? []).some(failure);
  if (!upToDate && (failed || green(pr))) return "rebase";
  if (failed) return "repair";
  if (
    green(pr) &&
    upToDate &&
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus === "CLEAN"
  )
    return "merge";
  return "wait";
}

export function humanApproved(
  reviews: readonly {
    readonly state: string;
    readonly author: {
      readonly login: string;
      readonly is_bot?: boolean | undefined;
    } | null;
  }[],
): boolean {
  return reviews.some(
    (review) =>
      review.state === "APPROVED" &&
      review.author !== null &&
      review.author.is_bot !== true &&
      review.author.login !== "dependabot[bot]" &&
      review.author.login !== "app/dependabot",
  );
}

const SENSITIVE_PATH =
  /^(?:\.github\/workflows\/.+|\.sandcastle\/.+|scripts\/ci\/.+|.*google-services\.json|.*\.env)$/;

/**
 * Whether a set of changed file paths touches the factory's own plumbing,
 * workflows, or credentials. Such a change is never auto-merged; it waits for
 * a human under every auto-merge policy.
 */
export function touchesSensitivePath(files: readonly string[]): boolean {
  return files.some((file) => SENSITIVE_PATH.test(file));
}

/**
 * A repair may add source fixes. It may not drop the original update or add
 * workflow, factory, or credential files the Dependabot head did not already touch.
 */
export function repairDrift(
  originalFiles: readonly string[],
  repairedFiles: readonly string[],
): string | null {
  const missing = originalFiles.filter((file) => !repairedFiles.includes(file));
  if (missing.length > 0) {
    return `dependency update no longer changes ${missing.join(", ")}`;
  }
  const added = repairedFiles.filter(
    (file) => !originalFiles.includes(file) && SENSITIVE_PATH.test(file),
  );
  if (added.length > 0) return `repair added ${added.join(", ")}`;
  return null;
}

export function canMerge(
  pr: BotPr,
  expectedHead: string,
  expectedBase: string,
  currentBase: string,
) {
  return (
    pr.headRefOid === expectedHead &&
    expectedBase === currentBase &&
    decide(pr, true) === "merge"
  );
}
