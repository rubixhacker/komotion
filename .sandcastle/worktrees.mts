import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/** One `git worktree list --porcelain` entry that is checked out on a branch. */
export interface WorktreeRow {
  readonly path: string;
  readonly branch: string;
}

export interface SweepDecision {
  readonly row: WorktreeRow;
  readonly remove: boolean;
  readonly reason: string;
  /**
   * Keep the branch after removing the worktree.
   *
   * A ticket branch with unmerged commits holds real work. The worktree itself
   * is disposable, but the branch must survive: `queue()` reads the branch as
   * ownership, so deleting it would lose the work and re-open the ticket.
   */
  readonly keepBranch?: boolean;
}

export const PREFLIGHT_PREFIX = "sandcastle/preflight-";
export const TICKET_PREFIX = "sandcastle/issue-";

/**
 * Read branch-backed worktrees out of `git worktree list --porcelain`. Detached
 * entries are skipped: the factory never creates one, so it has no claim on it.
 */
export function parseWorktreeList(porcelain: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  let path: string | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ") && path !== null)
      rows.push({
        path,
        branch: line.slice("branch ".length).replace(/^refs\/heads\//, ""),
      });
    else if (line.trim() === "") path = null;
  }
  return rows;
}

/**
 * Whether a worktree belongs to a Sandcastle run.
 *
 * The path shape identifies it, not the current checkout. Git worktrees share
 * one repository, so the runtime sees every worktree of the repository,
 * including the ones an earlier checkout created under its own
 * `.sandcastle/worktrees/`. A branch checked out there cannot be checked out
 * here, so those trees block new tickets until they are swept, and each one
 * costs about 700 MB.
 */
function isSandcastleWorktree(root: string, path: string): boolean {
  const resolved = resolve(path);
  const base = resolve(root, ".sandcastle", "worktrees");
  if (resolved.startsWith(`${base}${sep}`)) return true;
  const parts = resolved.split(sep);
  return parts.some(
    (segment, index) =>
      segment === "worktrees" && parts[index - 1] === ".sandcastle",
  );
}

/**
 * Decide one worktree's fate.
 *
 * A scratch preflight worktree is disposable. A ticket worktree is only
 * disposable while its branch holds no commits: the branch is what a retry
 * continues from, and `queue()` treats an existing `sandcastle/issue-N`
 * branch as ownership, so a branch left behind by a run that never committed
 * blocks that ticket forever.
 */
export function classifyWorktree(
  row: WorktreeRow,
  context: {
    readonly root: string;
    readonly keepBranches: ReadonlySet<string>;
    readonly commitsAhead: (branch: string) => number;
    /** Commits `git cherry` still marks `+`. Zero means a rebase merge already landed them. */
    readonly unmergedCommits?: (branch: string) => number;
  },
): SweepDecision {
  if (!isSandcastleWorktree(context.root, row.path))
    return { row, remove: false, reason: "outside .sandcastle/worktrees" };
  if (context.keepBranches.has(row.branch))
    return { row, remove: false, reason: "current pass" };
  if (row.branch.startsWith(PREFLIGHT_PREFIX))
    return { row, remove: true, reason: "preflight scratch" };
  if (row.branch.startsWith(TICKET_PREFIX)) {
    const ahead = context.commitsAhead(row.branch);
    if (ahead === 0)
      return { row, remove: true, reason: "abandoned ticket worktree with no commits" };
    if (context.unmergedCommits?.(row.branch) === 0)
      return { row, remove: true, reason: "ticket work is already on main" };
    // The branch holds work the runtime still needs, but the worktree blocks
    // the runtime from checking that branch out again. Release the worktree
    // and keep the branch, so the next pass can resume it.
    return {
      row,
      remove: true,
      keepBranch: true,
      reason: `ticket branch holds ${ahead} commit(s); worktree released, branch kept`,
    };
  }
  return { row, remove: false, reason: "unmanaged branch" };
}

export interface SweepPlan {
  readonly remove: readonly SweepDecision[];
  readonly keep: readonly SweepDecision[];
}

export function planSweep(
  rows: readonly WorktreeRow[],
  context: {
    readonly root: string;
    readonly keepBranches: ReadonlySet<string>;
    readonly commitsAhead: (branch: string) => number;
    readonly unmergedCommits?: (branch: string) => number;
  },
): SweepPlan {
  const decisions = rows.map((row) => classifyWorktree(row, context));
  return {
    remove: decisions.filter((decision) => decision.remove),
    keep: decisions.filter((decision) => !decision.remove),
  };
}

export interface BranchPruneDecision {
  readonly branch: string;
  readonly delete: boolean;
  readonly reason: string;
}

/**
 * Decide which Sandcastle branches to delete when no worktree holds them.
 *
 * `planSweep` only sees branches that a worktree has checked out, so a run
 * that commits nothing leaves its ticket branch behind once the worktree is
 * swept. `queue()` reads any `sandcastle/issue-N` branch as ownership, so that
 * empty branch would keep the ticket out of the queue forever. A branch that
 * holds commits is retained for manual inspection or resumption and is never
 * deleted here.
 *
 * A branch checked out in a worktree is left alone: git refuses to delete it,
 * and the sweep already decided that worktree's fate.
 */
export function planBranchPrune(
  branches: readonly string[],
  context: {
    readonly keepBranches: ReadonlySet<string>;
    readonly checkedOut: ReadonlySet<string>;
    readonly commitsAhead: (branch: string) => number;
    /** Commits `git cherry` still marks `+`. Zero means a rebase merge already landed them. */
    readonly unmergedCommits?: (branch: string) => number;
  },
): readonly BranchPruneDecision[] {
  const decisions: BranchPruneDecision[] = [];
  for (const branch of branches) {
    if (!branch.startsWith(TICKET_PREFIX) && !branch.startsWith(PREFLIGHT_PREFIX))
      continue;
    if (context.keepBranches.has(branch)) {
      decisions.push({ branch, delete: false, reason: "current pass" });
      continue;
    }
    if (context.checkedOut.has(branch)) {
      decisions.push({ branch, delete: false, reason: "checked out in a worktree" });
      continue;
    }
    const ahead = context.commitsAhead(branch);
    // A branch whose every patch is on main can be neither resumed nor
    // delivered, and it still reads as ownership: the worktree sweep already
    // removes such a branch when a worktree holds it, so one without a
    // worktree must go the same way or its ticket stays blocked.
    if (ahead !== 0 && context.unmergedCommits?.(branch) === 0) {
      decisions.push({ branch, delete: true, reason: "ticket work is already on main" });
      continue;
    }
    if (ahead !== 0) {
      decisions.push({
        branch,
        delete: false,
        reason: `holds ${ahead} commit(s); retained for a human`,
      });
      continue;
    }
    decisions.push({ branch, delete: true, reason: "abandoned branch with no commits" });
  }
  return decisions;
}

/** Apply a branch plan through the injected command runner. */
export function applyBranchPrune(
  decisions: readonly BranchPruneDecision[],
  run: SweepRunner,
): readonly BranchPruneDecision[] {
  const removed: BranchPruneDecision[] = [];
  for (const decision of decisions) {
    if (!decision.delete) continue;
    try {
      run("git", ["branch", "-D", decision.branch]);
      removed.push(decision);
    } catch {
      // The branch can be checked out elsewhere or already gone.
    }
  }
  return removed;
}

/**
 * Apply a plan through the injected command runner. A worktree is removed
 * before its branch, because git refuses to delete a checked-out branch.
 *
 * A removed worktree can still hold uncommitted work, so it is captured as a
 * patch first. `git worktree remove --force` discards it, and an agent that
 * was mid-edit would lose the result with nothing to show for it.
 */
/**
 * The command runner the sweep uses. It returns the command's output when the
 * caller asked for it, so the sweep can capture a worktree's uncommitted
 * diff before removing the tree.
 */
/**
 * The command runner the sweep uses. It returns the command's output when the
 * caller asked for it, so the sweep can capture a worktree's uncommitted
 * diff before removing the tree. A runner that only runs commands returns
 * undefined.
 */
export type SweepRunner = (
  program: string,
  args: readonly string[],
  cwd?: string,
) => string | undefined;

export function applySweep(
  plan: SweepPlan,
  run: SweepRunner,
  patchDir?: string,
): readonly SweepDecision[] {
  for (const decision of plan.remove) {
    if (decision.keepBranch && patchDir !== undefined) {
      try {
        const diff = run("git", ["diff", "HEAD"], decision.row.path);
        const text = diff ?? "";
        if (text.trim() !== "") {
          const name = decision.row.branch.replaceAll("/", "-");
          mkdirSync(resolve(patchDir, name), { recursive: true });
          writeFileSync(resolve(patchDir, name, "uncommitted.patch"), text);
        }
      } catch {
        // A worktree that is already gone has nothing to capture.
      }
    }
    try {
      run("git", ["worktree", "remove", "--force", decision.row.path]);
    } catch {
      // A worktree whose directory is already gone still has admin state;
      // `git worktree prune` below clears it.
    }
    if (decision.keepBranch === true) {
      // A kept branch keeps its commits; only the worktree goes.
      continue;
    }
    if (
      decision.row.branch.startsWith(PREFLIGHT_PREFIX) ||
      decision.row.branch.startsWith(TICKET_PREFIX)
    ) {
      try {
        run("git", ["branch", "-D", decision.row.branch]);
      } catch {
        // The branch can be checked out elsewhere or already gone.
      }
    }
  }
  run("git", ["worktree", "prune"]);
  return plan.remove;
}
