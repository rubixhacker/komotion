import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { FactoryPr } from "./factory-ci.mjs";
import { autoMergeArmed, AutoMergeState, GithubReview } from "./factory-delivery.mjs";
import { FACTORY_PR_JSON_FIELDS } from "./factory-prs.mjs";
import {
  MergedFactoryPr,
  planMergeReconciliation,
} from "./merge-reconciliation.mjs";
import { REPO, type PullRequest, type Ticket } from "./queue.mjs";
import { applySweep, parseWorktreeList } from "./worktrees.mjs";

const REVIEW_LABEL = "device-evidence-pending";
const LiveIssue = z.object({
  state: z.string(),
  labels: z.array(z.object({ name: z.string() })),
});

function readIssue(root: string, issue: number) {
  return LiveIssue.parse(
    JSON.parse(
      command(root, "gh", [
        "issue",
        "view",
        String(issue),
        "--repo",
        REPO,
        "--json",
        "state,labels",
      ]),
    ),
  );
}

export interface FactorySnapshot {
  readonly issues: readonly Ticket[];
  readonly prs: readonly PullRequest[];
  readonly branches: string;
}

/** Host-only Git/GitHub execution. No credential or CLI path enters a sandbox. */
function command(root: string, program: string, args: readonly string[]): string {
  return execFileSync(program, [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function lines(root: string, filename: string): string[] {
  try {
    return JSON.parse(readFileSync(resolve(root, ".sandcastle/logs", filename), "utf8"))
      .filter((value: unknown): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeLines(root: string, filename: string, values: readonly string[]): void {
  const file = resolve(root, ".sandcastle/logs", filename);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify([...new Set(values)].slice(-500), null, 2)}\n`);
}

function audit(root: string, event: Record<string, unknown>): void {
  const file = resolve(root, ".sandcastle/logs/merge-reconciliation.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

/** Append an event to the shared merge-reconciliation audit log. */
export { audit as auditFactoryEvent };

/**
 * The current GitHub and git reads the arm-merge script needs. Arming lives in
 * that one script so the sweep and the green-CI dispatch event share a single
 * trust bar; it imports these instead of growing a second set of `gh` calls.
 */
export {
  command as factoryCommand,
  pullRequest as factoryPullRequest,
  reviews as factoryReviews,
  mergeState as factoryMergeState,
  prFiles as factoryPrFiles,
  upToDateWithMain as factoryMainIsAncestor,
};

/** Whether an open factory PR already has an armed rebase auto-merge, or has merged. */
export function factoryPrArmed(root: string, pr: number): boolean {
  return autoMergeArmed(mergeState(root, pr));
}

function branchHead(root: string, qualifiedRef: string, remote?: string): string | null {
  if (remote !== undefined) {
    const output = command(root, "git", ["ls-remote", remote, qualifiedRef]);
    const match = /^([0-9a-f]{40})\s/.exec(output);
    return match?.[1] ?? null;
  }
  const present = spawnSync("git", ["show-ref", "--verify", "--quiet", qualifiedRef], {
    cwd: root,
  });
  if (present.status === 1) return null;
  if (present.status !== 0) throw new Error(`git show-ref failed for ${qualifiedRef}`);
  return command(root, "git", ["rev-parse", "--verify", qualifiedRef]);
}

function ensureHead(root: string, head: string): boolean {
  let present = spawnSync("git", ["cat-file", "-e", `${head}^{commit}`], { cwd: root });
  if (present.status !== 0) {
    const fetched = spawnSync("git", ["fetch", "origin", head], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (fetched.status !== 0) return false;
    present = spawnSync("git", ["cat-file", "-e", `${head}^{commit}`], { cwd: root });
  }
  if (present.status !== 0) return false;
  if (spawnSync("git", ["merge-base", "--is-ancestor", head, "origin/main"], {
    cwd: root,
  }).status === 0)
    return true;
  try {
    return !command(root, "git", ["cherry", "origin/main", head])
      .split("\n")
      .some((line) => line.startsWith("+"));
  } catch {
    return false;
  }
}

/**
 * Whether a merged pull request's exact head has landed on main. A rebase onto
 * a main that moved changes a commit's patch, so `git cherry` can call a merged
 * head unlanded; GitHub's own merge commit, now on main, proves it landed.
 */
export function landedOnMain(root: string, pr: MergedFactoryPr): boolean {
  if (ensureHead(root, pr.headRefOid)) return true;
  const merge = pr.mergeCommit?.oid;
  if (pr.state !== "MERGED" || merge === undefined) return false;
  return (
    spawnSync("git", ["cat-file", "-e", `${merge}^{commit}`], { cwd: root }).status === 0 &&
    spawnSync("git", ["merge-base", "--is-ancestor", merge, "origin/main"], { cwd: root })
      .status === 0
  );
}

function upToDateWithMain(root: string, head: string): boolean {
  return (
    ensureHead(root, head) &&
    spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", head], {
      cwd: root,
    }).status === 0
  );
}

function worktreeRows(root: string, branch: string) {
  return parseWorktreeList(command(root, "git", ["worktree", "list", "--porcelain"])).filter(
    (row) => row.branch === branch,
  );
}

function dirtyWorktree(root: string, branch: string): boolean {
  for (const row of worktreeRows(root, branch)) {
    if (!row.path.includes(`${resolve(".sandcastle", "worktrees")}/`)) return true;
    try {
      if (
        command(row.path, "git", [
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--",
          ".",
          ":!.sandcastle",
        ]) !== ""
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Remove a merged delivery's marks from the ledgers.
 *
 * A delivery's escalation marks come in several shapes: the bare head, the
 * conflict-marked head, the per-pull-request cancelled mark, and the earlier
 * heads the delivery passed through before it merged. The merge clears the
 * merged head and every mark owned by its pull request, so the delivery's
 * history stops counting as a failed delivery whether or not its branch
 * cleanup succeeded.
 */
export function clearHeadRecords(root: string, prNumber: number, head: string): void {
  const owned = (candidate: string) =>
    candidate === head ||
    candidate === `${head}:conflict` ||
    candidate.startsWith(`pr:${prNumber}:`);
  for (const name of ["resume-attempts.json", "ci-alerts.json"]) {
    writeLines(root, name, lines(root, name).filter((candidate) => !owned(candidate)));
  }
}

/**
 * The head a ledger mark records, or null when the mark names no head. A mark
 * is a bare head, a conflict-marked head, or a per-pull-request key whose
 * last component is the head.
 */
function markHead(candidate: string): string | null {
  const mark = candidate.endsWith(":conflict")
    ? candidate.slice(0, -":conflict".length)
    : candidate;
  const tail = mark.slice(mark.lastIndexOf(":") + 1);
  const value = tail === "" ? mark : tail;
  return /^[0-9a-f]{40}$/.test(value) ? value : null;
}

/**
 * Remove the marks of deliveries that have ended from the ledgers.
 *
 * The ledgers are escalation history, and the delivery-failure signal counts
 * every entry they hold, so a mark whose delivery has ended must be removed
 * or it latches the stall alert. A delivery ends when its head lands on main.
 * This reaches the marks the merge clear path does not know: the marks written
 * by the key scheme before marks carried a pull request number (a bare head
 * or a conflict head), and every per-pull-request mark of a delivery the
 * reconciliation ledger already records, which the per-pull-request
 * reconciliation skips.
 */
export function clearEndedDeliveryMarks(root: string): void {
  const reconciledPrs = new Set(
    lines(root, "reconciled-merges.json")
      .map((key) => key.split(":")[0])
      .filter((prNumber): prNumber is string => prNumber !== undefined),
  );
  for (const name of ["resume-attempts.json", "ci-alerts.json"]) {
    const kept = lines(root, name).filter(
      (candidate) => !endedDeliveryMark(root, candidate, reconciledPrs),
    );
    writeLines(root, name, kept);
  }
}

function endedDeliveryMark(
  root: string,
  candidate: string,
  reconciledPrs: ReadonlySet<string>,
): boolean {
  const prNumber = /^pr:(\d+):/.exec(candidate)?.[1];
  if (prNumber !== undefined) {
    // A per-pull-request mark is ended when its delivery is recorded in the
    // reconciliation ledger; the merge clear path handles the rest.
    return reconciledPrs.has(prNumber);
  }
  // A mark without a pull request number is the old key scheme: a bare head
  // or a conflict head. It is ended when the head landed on main.
  const head = markHead(candidate);
  return head !== null && ensureHead(root, head);
}

function mergedPrs(root: string): MergedFactoryPr[] {
  const fields =
    "number,title,body,url,state,headRefName,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,labels,closingIssuesReferences";
  return z.array(MergedFactoryPr).parse(
    JSON.parse(
      command(root, "gh", [
        "pr",
        "list",
        "--repo",
        REPO,
        "--state",
        "merged",
        "--limit",
        "200",
        "--json",
        fields,
      ]),
    ),
  );
}

/**
 * Remove a merged ticket's worktree, local branch, and remote branch.
 *
 * Every deletion is guarded by the exact merged head: a moved or recreated
 * ref is refused and nothing is deleted. The worktree goes first with the
 * branch kept, then the local ref is removed by expected-old-value
 * `update-ref` and the remote by `--force-with-lease`, so a concurrent
 * re-creation between check and delete cannot be swept away.
 */
export function cleanupMergedBranch(root: string, pr: MergedFactoryPr): boolean {
  const branch = pr.headRefName;
  const rows = worktreeRows(root, branch);
  applySweep(
    {
      // Keep the ref through worktree removal; the expected-old-value update
      // below is the atomic guard against deleting a recreated local head.
      remove: rows.map((row) => ({
        row,
        remove: true,
        keepBranch: true,
        reason: `merged in PR #${pr.number}`,
      })),
      keep: [],
    },
    (program, args, cwd) =>
      execFileSync(program, [...args], {
        cwd: cwd ?? root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
  );
  const local = branchHead(root, `refs/heads/${branch}`);
  if (local !== null) {
    if (local !== pr.headRefOid) return false;
    // Compare-and-delete prevents a newly recreated local head being removed.
    command(root, "git", ["update-ref", "-d", `refs/heads/${branch}`, pr.headRefOid]);
  }
  const remote = branchHead(root, `refs/heads/${branch}`, "origin");
  if (remote !== null) {
    if (remote !== pr.headRefOid) return false;
    // The lease keeps an exact-head delete from removing a recreated remote branch.
    command(root, "git", [
      "push",
      "origin",
      `--force-with-lease=refs/heads/${branch}:${pr.headRefOid}`,
      "--delete",
      branch,
    ]);
  }
  spawnSync("git", ["branch", "-dr", `origin/${branch}`], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (
    branchHead(root, `refs/heads/${branch}`) === null &&
    branchHead(root, `refs/remotes/origin/${branch}`) === null &&
    branchHead(root, `refs/heads/${branch}`, "origin") === null
  );
}

/**
 * Close and clean merged work before the eligible queue is computed. The live
 * issue is re-read before closure; pending native evidence never auto-closes.
 */
export function reconcileMergedFactoryPrs(root: string, initial: FactorySnapshot): void {
  // A delivery's marks stop counting as a failed delivery whether or not its
  // branch cleanup succeeded, and whether or not the delivery is already
  // reconciled: the ledger is escalation history, and the failure signal
  // counts every entry it holds.
  clearEndedDeliveryMarks(root);
  const reconciled = lines(root, "reconciled-merges.json");
  for (const pr of mergedPrs(root)) {
    const issue = /^sandcastle\/issue-(\d+)$/.exec(pr.headRefName)?.[1];
    if (issue === undefined) continue;
    const key = `${pr.number}:${pr.headRefOid}`;
    if (reconciled.includes(key)) continue;
    const issueOpen = initial.issues.some((candidate) => candidate.number === Number(issue));
    const ownedRef = new RegExp(`(?:^|/)sandcastle/issue-${issue}(?:\\D|$)`, "m").test(
      initial.branches,
    );
    if (!issueOpen && !ownedRef) {
      // A merged delivery that was never recorded (a cleanup that threw after
      // deleting the refs, or a pass that stopped before recording) still owns
      // escalation marks. Clear them and record the delivery so the guard does
      // not abandon it on the next pass.
      clearHeadRecords(root, pr.number, pr.headRefOid);
      writeLines(root, "reconciled-merges.json", [...reconciled, key]);
      reconciled.push(key);
      continue;
    }
    try {
      const localHead = branchHead(root, `refs/heads/${pr.headRefName}`);
      const remoteHead = branchHead(root, `refs/heads/${pr.headRefName}`, "origin");
      const live = issueOpen ? readIssue(root, Number(issue)) : null;
      const currentlyOpen = live?.state === "OPEN";
      const pending =
        pr.labels.some((label) => label.name === REVIEW_LABEL) ||
        pr.body.includes("Device/store evidence pending:") ||
        live?.labels.some((label) => label.name === REVIEW_LABEL) === true;
      const plan = planMergeReconciliation(pr, {
        localHead,
        remoteHead,
        landed: landedOnMain(root, pr),
        openPr: initial.prs.some((candidate) => candidate.headRefName === pr.headRefName),
        issueOpen: currentlyOpen,
        deviceEvidencePending: pending,
        worktreeDirty: dirtyWorktree(root, pr.headRefName),
      });
      let heldForEvidence = false;
      if (currentlyOpen && pending && plan.cleanup && plan.issue !== null) {
        // Once the owning PR and branch are gone, this hold is what prevents an
        // evidence-pending ticket being implemented a second time.
        command(root, "gh", [
          "issue",
          "edit",
          String(plan.issue),
          "--repo",
          REPO,
          "--add-label",
          "ready-for-human",
          "--add-label",
          REVIEW_LABEL,
          "--remove-label",
          "ready-for-agent",
        ]);
        heldForEvidence = true;
      }
      let closed = false;
      if (
        plan.closeIssue &&
        plan.issue !== null &&
        plan.mergeSha !== null &&
        live?.state === "OPEN" &&
        !pending
      ) {
        command(root, "gh", [
          "issue",
          "close",
          String(plan.issue),
          "--repo",
          REPO,
          "--reason",
          "completed",
          "--comment",
          `Completed by merged PR #${pr.number} at ${plan.mergeSha}. The merged changes were verified on origin/main; review and check evidence is recorded on the PR.`,
        ]);
        closed = true;
      }
      // A merged delivery is done whether or not its branch cleanup succeeded,
      // so its escalation marks stop counting as a failed delivery either way.
      // Clearing before the cleanup means a cleanup that throws, returns
      // false, or is interrupted after deleting the refs still cannot latch
      // the gauge.
      clearHeadRecords(root, pr.number, pr.headRefOid);
      const cleaned = plan.cleanup ? cleanupMergedBranch(root, pr) : false;
      const complete = !currentlyOpen || closed || heldForEvidence;
      // A blocked cleanup is never complete: a closed issue must not make a
      // moved, dirty or unproven branch permanent in the reconciliation ledger.
      if (complete && cleaned) {
        writeLines(root, "reconciled-merges.json", [...reconciled, key]);
        reconciled.push(key);
      }
      audit(root, {
        event: "merged-pr-reconciliation",
        pr: pr.number,
        issue: plan.issue,
        head: pr.headRefOid,
        mergeSha: plan.mergeSha,
        closed,
        heldForEvidence,
        cleaned,
        reason: plan.reason,
        complete: complete && (!plan.cleanup || cleaned),
      });
    } catch (error) {
      audit(root, {
        event: "merged-pr-reconciliation-error",
        pr: pr.number,
        head: pr.headRefOid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function pullRequest(root: string, ref: string | number): FactoryPr {
  return FactoryPr.parse(
    JSON.parse(
      command(root, "gh", [
        "pr",
        "view",
        String(ref),
        "--repo",
        REPO,
        "--json",
        FACTORY_PR_JSON_FIELDS,
      ]),
    ),
  );
}

function reviews(root: string, pr: number): GithubReview[] {
  const pages = z.array(z.array(GithubReview)).parse(
    JSON.parse(
      command(root, "gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${REPO}/pulls/${pr}/reviews?per_page=100`,
      ]),
    ),
  );
  return pages.flat();
}

function mergeState(root: string, pr: number): AutoMergeState {
  return AutoMergeState.parse(
    JSON.parse(
      command(root, "gh", [
        "pr",
        "view",
        String(pr),
        "--repo",
        REPO,
        "--json",
        "state,autoMergeRequest",
      ]),
    ),
  );
}

/** The PR's changed file paths, so the merge gate can keep a human on factory plumbing. */
function prFiles(root: string, pr: number): string[] {
  try {
    return z
      .array(z.object({ filename: z.string() }))
      .parse(
        JSON.parse(
          command(root, "gh", [
            "api",
            "--paginate",
            "--slurp",
            `repos/${REPO}/pulls/${pr}/files?per_page=100`,
          ]),
        ),
      )
      .map((file) => file.filename);
  } catch {
    return [];
  }
}
