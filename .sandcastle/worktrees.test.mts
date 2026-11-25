import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBranchPrune,
  applySweep,
  classifyWorktree,
  parseWorktreeList,
  planBranchPrune,
  planSweep,
  type WorktreeRow,
} from "./worktrees.mjs";

const root = "/repo";

test("the worktree list keeps branch checkouts and skips detached entries", () => {
  // Given: porcelain output with one branch worktree and one detached checkout.
  const porcelain = [
    "worktree /repo/.sandcastle/worktrees/sandcastle-preflight-1",
    "HEAD abc123",
    "branch refs/heads/sandcastle/preflight-1",
    "",
    "worktree /repo/.cache/scratch",
    "HEAD def456",
    "detached",
    "",
  ].join("\n");
  // When: the list is parsed.
  const rows = parseWorktreeList(porcelain);
  // Then: only the branch entry is a factory-managed row.
  assert.deepEqual(rows, [
    {
      path: "/repo/.sandcastle/worktrees/sandcastle-preflight-1",
      branch: "sandcastle/preflight-1",
    },
  ]);
});

const ticket = (number: number): WorktreeRow => ({
  path: join(root, ".sandcastle", "worktrees", `sandcastle-issue-${number}`),
  branch: `sandcastle/issue-${number}`,
});

const context = (commitsAhead: (branch: string) => number) => ({
  root,
  keepBranches: new Set<string>(),
  commitsAhead,
});

test("a preflight worktree is always disposable", () => {
  // Given: a scratch preflight worktree from an earlier pass.
  const row = {
    path: join(root, ".sandcastle", "worktrees", "sandcastle-preflight-9"),
    branch: "sandcastle/preflight-9",
  };
  // When: it is classified.
  const decision = classifyWorktree(row, context(() => 0));
  // Then: it is removed as scratch.
  assert.equal(decision.remove, true);
  assert.equal(decision.reason, "preflight scratch");
});

test("an abandoned ticket branch with no commits is removed and unblocks the ticket", () => {
  // Given: a ticket worktree whose branch never committed, as a stalled run leaves.
  // When: it is classified.
  const decision = classifyWorktree(ticket(1929), context(() => 0));
  // Then: both the worktree and its branch go, because queue() reads that branch as ownership.
  assert.equal(decision.remove, true);
  assert.equal(decision.reason, "abandoned ticket worktree with no commits");
});

test("a ticket branch whose commits already landed is removed", () => {
  const decision = classifyWorktree(ticket(1931), {
    ...context(() => 2),
    unmergedCommits: () => 0,
  });
  assert.equal(decision.remove, true);
  assert.equal(decision.reason, "ticket work is already on main");
});

test("a ticket branch holding commits keeps its work but releases the worktree", () => {
  // Given: a ticket worktree whose branch has two commits to inspect or retry.
  // When: it is classified.
  const decision = classifyWorktree(ticket(1930), context(() => 2));
  // Then: the worktree goes, so the runtime can check the branch out again,
  // and the branch stays, so the commits are not lost.
  assert.equal(decision.remove, true);
  assert.equal(decision.keepBranch, true);
  assert.match(decision.reason, /branch kept/);
});

test("the pass's own worktree is never swept", () => {
  // Given: a preflight worktree that is currently in use.
  const row = {
    path: join(root, ".sandcastle", "worktrees", "sandcastle-preflight-7"),
    branch: "sandcastle/preflight-7",
  };
  // When: it is classified with its branch marked as current.
  const decision = classifyWorktree(row, {
    root,
    keepBranches: new Set(["sandcastle/preflight-7"]),
    commitsAhead: () => 0,
  });
  // Then: the running pass keeps its scratch tree.
  assert.equal(decision.remove, false);
  assert.equal(decision.reason, "current pass");
});

test("worktrees the factory does not own are left alone", () => {
  // Given: a worktree outside .sandcastle/worktrees and an unmanaged branch.
  const outside = classifyWorktree(
    { path: "/tmp/opencode/review-1787", branch: "takeover/issue-1787" },
    context(() => 0),
  );
  const unmanaged = classifyWorktree(
    { path: join(root, ".sandcastle", "worktrees", "x"), branch: "feat/1737-review-app" },
    context(() => 3),
  );
  // Then: neither is claimed.
  assert.equal(outside.remove, false);
  assert.equal(unmanaged.remove, false);
});

test("a worktree of an earlier checkout is still factory work", () => {
  // Given: a worktree under another checkout's .sandcastle/worktrees.
  // Git worktrees share one repository, so this branch cannot be checked out
  // in the runtime until the old tree is gone.
  const earlier = classifyWorktree(
    {
      path: "/repo-elsewhere/.sandcastle/worktrees/sandcastle-issue-1930",
      branch: "sandcastle/issue-1930",
    },
    context(() => 0),
  );
  // Then: it is claimed.
  assert.equal(earlier.remove, true);
});

test("planning partitions the list into removals and keeps", () => {
  // Given: one preflight tree, one empty ticket branch and one with commits.
  const plan = planSweep(
    [
      {
        path: join(root, ".sandcastle", "worktrees", "sandcastle-preflight-2"),
        branch: "sandcastle/preflight-2",
      },
      ticket(1923),
      ticket(1930),
    ],
    context((branch) => (branch === "sandcastle/issue-1930" ? 1 : 0)),
  );
  // When/Then: the scratch tree and the empty branch go; the branch with
  // commits is released but kept.
  assert.deepEqual(
    plan.remove.map((decision) => decision.row.branch),
    ["sandcastle/preflight-2", "sandcastle/issue-1923", "sandcastle/issue-1930"],
  );
  assert.deepEqual(plan.keep, []);
  assert.equal(
    plan.remove.find((decision) => decision.row.branch === "sandcastle/issue-1930")
      ?.keepBranch,
    true,
  );
});

test("applying a plan removes each worktree before its branch, then prunes", () => {
  // Given: a plan with one preflight removal and one worktree removal that fails.
  const calls: string[] = [];
  const plan = {
    remove: [
      { row: ticket(1923), remove: true, reason: "abandoned" },
      {
        row: { path: join(root, ".sandcastle", "worktrees", "gone"), branch: "sandcastle/preflight-3" },
        remove: true,
        reason: "preflight scratch",
      },
    ],
    keep: [],
  };
  // When: the plan is applied and one worktree directory is already missing.
  applySweep(plan, (program, args) => {
    calls.push(`${program} ${args.join(" ")}`);
    if (args[0] === "worktree" && args.includes("gone")) throw new Error("not a worktree");
    return undefined;
  });
  // Then: every worktree is removed before any branch, and the prune runs last.
  assert.deepEqual(calls, [
    `git worktree remove --force ${join(root, ".sandcastle", "worktrees", "sandcastle-issue-1923")}`,
    "git branch -D sandcastle/issue-1923",
    `git worktree remove --force ${join(root, ".sandcastle", "worktrees", "gone")}`,
    "git branch -D sandcastle/preflight-3",
    "git worktree prune",
  ]);
});

test("a kept branch is not deleted and its uncommitted work is captured", () => {
  // Given: a plan that releases a worktree but keeps its branch.
  const calls: string[] = [];
  const patchDir = mkdtempSync(join(tmpdir(), "sandcastle-patch-test-"));
  const plan = {
    remove: [
      {
        row: ticket(1930),
        remove: true,
        keepBranch: true,
        reason: "ticket branch holds 2 commit(s)",
      },
    ],
    keep: [],
  };
  try {
    // When: the plan is applied.
    applySweep(
      plan,
      (program, args) => {
        calls.push(`${program} ${args.join(" ")}`);
        if (args[0] === "diff") return "diff --git a/A b/A\n+work";
        return undefined;
      },
      patchDir,
    );
    // Then: the branch is kept and the uncommitted work is saved.
    assert.deepEqual(calls, [
      "git diff HEAD",
      `git worktree remove --force ${join(root, ".sandcastle", "worktrees", "sandcastle-issue-1930")}`,
      "git worktree prune",
    ]);
    const saved = readFileSync(
      join(patchDir, "sandcastle-issue-1930", "uncommitted.patch"),
      "utf8",
    );
    assert.match(saved, /\+work/);
  } finally {
    rmSync(patchDir, { recursive: true, force: true });
  }
});

const pruneContext = (overrides: {
  keepBranches?: readonly string[];
  checkedOut?: readonly string[];
  commitsAhead?: (branch: string) => number;
  unmergedCommits?: (branch: string) => number;
} = {}) => ({
  keepBranches: new Set(overrides.keepBranches ?? []),
  checkedOut: new Set(overrides.checkedOut ?? []),
  commitsAhead: overrides.commitsAhead ?? (() => 0),
  ...(overrides.unmergedCommits === undefined
    ? {}
    : { unmergedCommits: overrides.unmergedCommits }),
});

test("an empty ticket branch left without a worktree is pruned", () => {
  // Given: a ticket branch no worktree holds and no run gave a commit.
  const decisions = planBranchPrune(
    ["sandcastle/issue-2049"],
    pruneContext(),
  );
  // Then: it is deleted so its ticket returns to the queue.
  assert.deepEqual(decisions, [
    {
      branch: "sandcastle/issue-2049",
      delete: true,
      reason: "abandoned branch with no commits",
    },
  ]);
});

test("a ticket branch holding commits is retained for a human", () => {
  // Given: a branch with one commit that no worktree checks out.
  const decisions = planBranchPrune(
    ["sandcastle/issue-2038"],
    pruneContext({
      commitsAhead: (branch) => (branch === "sandcastle/issue-2038" ? 1 : 0),
    }),
  );
  // Then: the work is kept rather than silently discarded.
  assert.equal(decisions[0]?.delete, false);
  assert.equal(decisions[0]?.reason, "holds 1 commit(s); retained for a human");
});

test("a branch checked out in a worktree is never pruned", () => {
  // Given: an empty ticket branch that the runtime still has checked out.
  const decisions = planBranchPrune(
    ["sandcastle/issue-2017"],
    pruneContext({ checkedOut: ["sandcastle/issue-2017"] }),
  );
  // Then: git is not asked to delete a checked-out branch.
  assert.equal(decisions[0]?.delete, false);
  assert.equal(decisions[0]?.reason, "checked out in a worktree");
});

test("the pass's own preflight branch is never pruned", () => {
  // Given: the scratch branch this pass created.
  const decisions = planBranchPrune(
    ["sandcastle/preflight-1794521218170"],
    pruneContext({ keepBranches: ["sandcastle/preflight-1794521218170"] }),
  );
  // Then: the current pass keeps it.
  assert.equal(decisions[0]?.delete, false);
  assert.equal(decisions[0]?.reason, "current pass");
});

test("planning ignores branches the factory does not own", () => {
  // Given: mainline and a contributor branch.
  const decisions = planBranchPrune(
    ["main", "feat/1737-review-app"],
    pruneContext(),
  );
  // Then: neither is a factory branch, so neither is considered.
  assert.deepEqual(decisions, []);
});

test("applying a branch plan deletes only the empty branches", () => {
  // Given: one branch to delete and one retained.
  const calls: string[] = [];
  const decisions = planBranchPrune(["sandcastle/issue-2049"], pruneContext());
  const kept = planBranchPrune(
    ["sandcastle/issue-2038"],
    pruneContext({ commitsAhead: () => 1 }),
  );
  // When: the plans are applied.
  const removed = applyBranchPrune([...decisions, ...kept], (program, args) => {
    calls.push(`${program} ${args.join(" ")}`);
    return undefined;
  });
  // Then: only the empty branch is deleted, and it is reported.
  assert.deepEqual(calls, ["git branch -D sandcastle/issue-2049"]);
  assert.deepEqual(
    removed.map((decision) => decision.branch),
    ["sandcastle/issue-2049"],
  );
});

test("a worktree-less ticket branch whose work is all on main is pruned", () => {
  // Given: a branch two commits ahead of main by count, both already landed
  // by a rebase merge, with no worktree. It cannot be resumed (there is
  // nothing left to deliver) and it still blocks its ticket.
  const decisions = planBranchPrune(
    ["sandcastle/issue-2006", "sandcastle/issue-2038"],
    pruneContext({
      commitsAhead: () => 2,
      unmergedCommits: (branch) => (branch === "sandcastle/issue-2006" ? 0 : 2),
    }),
  );
  // Then: the landed branch goes and the one holding real work stays.
  assert.deepEqual(decisions, [
    { branch: "sandcastle/issue-2006", delete: true, reason: "ticket work is already on main" },
    {
      branch: "sandcastle/issue-2038",
      delete: false,
      reason: "holds 2 commit(s); retained for a human",
    },
  ]);
});
