import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { deliveryFailedCount, deliveryStallState } from "./delivery-stall.mjs";
import {
  type FactorySnapshot,
  cleanupMergedBranch,
  landedOnMain,
  reconcileMergedFactoryPrs,
} from "./factory-host.mjs";
import type { MergedFactoryPr } from "./merge-reconciliation.mjs";

const BRANCH = "sandcastle/issue-1";

interface Fixture {
  readonly base: string;
  readonly root: string;
  readonly head: string;
  readonly pr: MergedFactoryPr;
  git(args: readonly string[]): string;
  dispose(): void;
}

function gitIn(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/**
 * A local clone of a bare origin holding one merged factory ticket: the
 * branch exists at the same head locally and on origin, and its commit has
 * landed on main as a patch-equivalent rebase merge.
 */
function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "sandcastle-factory-host-"));
  const origin = join(base, "origin.git");
  const root = join(base, "root");
  mkdirSync(root);
  gitIn(base, ["init", "--bare", "-b", "main", origin]);
  gitIn(root, ["init", "-b", "main"]);
  gitIn(root, ["remote", "add", "origin", origin]);
  gitIn(root, ["config", "user.email", "factory@example.invalid"]);
  gitIn(root, ["config", "user.name", "Sandcastle Factory"]);
  // The host's global git config may force signed commits; the fixture
  // sets its own signing policy so the check passes on any host.
  gitIn(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "file.txt"), "base\n");
  gitIn(root, ["add", "file.txt"]);
  gitIn(root, ["commit", "-m", "Base commit"]);
  gitIn(root, ["push", "origin", "main"]);
  gitIn(root, ["checkout", "-b", BRANCH]);
  writeFileSync(join(root, "file.txt"), "base\nfixed\n");
  gitIn(root, ["commit", "-am", "Fix ticket"]);
  const head = gitIn(root, ["rev-parse", "HEAD"]);
  gitIn(root, ["push", "origin", BRANCH]);
  gitIn(root, ["checkout", "main"]);
  gitIn(root, ["cherry-pick", head]);
  const merge = gitIn(root, ["rev-parse", "HEAD"]);
  gitIn(root, ["push", "origin", "main"]);
  const pr: MergedFactoryPr = {
    number: 42,
    title: "Fix ticket",
    body: "Fixes #1",
    url: "https://github.com/rubixhacker/komotion/pull/42",
    state: "MERGED",
    headRefName: BRANCH,
    headRefOid: head,
    baseRefName: "main",
    isCrossRepository: false,
    mergedAt: "2026-11-12T10:00:00Z",
    mergeCommit: { oid: merge },
    labels: [],
    closingIssuesReferences: [{ number: 1 }],
  };
  return {
    base,
    root,
    head,
    pr,
    git: (args) => gitIn(root, args),
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

function localHead(f: Fixture): string | null {
  try {
    return f.git(["rev-parse", "--verify", `refs/heads/${BRANCH}`]);
  } catch {
    return null;
  }
}

function remoteHead(f: Fixture): string | null {
  const output = f.git(["ls-remote", "origin", `refs/heads/${BRANCH}`]);
  return output === "" ? null : output.split(/\s+/)[0]!;
}

function refPresent(f: Fixture, ref: string): boolean {
  try {
    f.git(["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A `gh` on PATH that answers the reconciliation's read commands with canned
 * JSON and records every invocation, so the test can prove what the host told
 * GitHub to do.
 */
function withGhStub(f: Fixture, mergedPrs: MergedFactoryPr[], issue: unknown): () => string {
  const bin = join(f.base, "bin");
  mkdirSync(bin);
  const mergedFile = join(f.base, "merged-prs.json");
  const issueFile = join(f.base, "issue.json");
  const log = join(f.base, "gh-stub.log");
  writeFileSync(mergedFile, JSON.stringify(mergedPrs));
  writeFileSync(issueFile, JSON.stringify(issue));
  const stub = join(bin, "gh");
  writeFileSync(
    stub,
    [
      "#!/bin/bash",
      `echo "gh $*" >> "${log}"`,
      'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
      `  cat "${mergedFile}"`,
      "  exit 0",
      "fi",
      'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
      `  cat "${issueFile}"`,
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  return () => {
    process.env.PATH = oldPath;
    return readFileSync(log, "utf8");
  };
}

function snapshot(branches: string): FactorySnapshot {
  return {
    issues: [
      {
        number: 1,
        title: "Ticket",
        body: "Fix the thing",
        labels: [{ name: "ready-for-agent" }],
      },
    ],
    prs: [],
    branches,
  };
}

function ledger(root: string): string[] {
  try {
    return JSON.parse(
      readFileSync(join(root, ".sandcastle/logs/reconciled-merges.json"), "utf8"),
    );
  } catch {
    return [];
  }
}

function lastAuditEvent(root: string): Record<string, unknown> {
  const lines = readFileSync(
    join(root, ".sandcastle/logs/merge-reconciliation.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n");
  return JSON.parse(lines.at(-1)!);
}

test("an exact local and remote head is removed together with its worktree", () => {
  const f = makeFixture();
  try {
    f.git(["worktree", "add", join(f.root, ".sandcastle/worktrees/ticket-1"), BRANCH]);
    assert.equal(cleanupMergedBranch(f.root, f.pr), true);
    assert.equal(localHead(f), null);
    assert.equal(remoteHead(f), null);
    assert.equal(refPresent(f, `refs/remotes/origin/${BRANCH}`), false);
    assert.ok(
      !f.git(["worktree", "list", "--porcelain"]).includes(".sandcastle/worktrees/ticket-1"),
    );
  } finally {
    f.dispose();
  }
});

test("a moved local head refuses cleanup and keeps both refs", () => {
  const f = makeFixture();
  try {
    f.git(["checkout", BRANCH]);
    writeFileSync(join(f.root, "moved.txt"), "moved\n");
    f.git(["add", "moved.txt"]);
    f.git(["commit", "-m", "Moved local head"]);
    const moved = f.git(["rev-parse", "HEAD"]);
    assert.equal(cleanupMergedBranch(f.root, f.pr), false);
    assert.equal(localHead(f), moved);
    assert.equal(remoteHead(f), f.head);
  } finally {
    f.dispose();
  }
});

test("a moved remote head refuses the remote delete and keeps it", () => {
  const f = makeFixture();
  try {
    writeFileSync(join(f.root, "moved.txt"), "moved\n");
    f.git(["add", "moved.txt"]);
    const tree = f.git(["write-tree"]);
    const moved = f.git(["commit-tree", tree, "-p", f.head, "-m", "Moved remote head"]);
    f.git(["reset"]);
    f.git(["push", "origin", `${moved}:refs/heads/${BRANCH}`]);
    assert.equal(cleanupMergedBranch(f.root, f.pr), false);
    // The local exact head is proven merged and is removed before the remote
    // is checked; the moved remote head is the one that must survive.
    assert.equal(localHead(f), null);
    assert.equal(remoteHead(f), moved);
  } finally {
    f.dispose();
  }
});

test("absent local and remote refs are an idempotent success", () => {
  const f = makeFixture();
  try {
    f.git(["branch", "-D", BRANCH]);
    f.git(["push", "origin", "--delete", BRANCH]);
    assert.equal(cleanupMergedBranch(f.root, f.pr), true);
    assert.equal(localHead(f), null);
    assert.equal(remoteHead(f), null);
  } finally {
    f.dispose();
  }
});

test("a blocked cleanup is never recorded as reconciled", () => {
  const f = makeFixture();
  try {
    f.git(["checkout", BRANCH]);
    writeFileSync(join(f.root, "moved.txt"), "moved\n");
    f.git(["add", "moved.txt"]);
    f.git(["commit", "-m", "Moved local head"]);
    const moved = f.git(["rev-parse", "HEAD"]);
    const restorePath = withGhStub(f, [f.pr], { state: "OPEN", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      restorePath();
    }
    assert.deepEqual(ledger(f.root), []);
    assert.equal(localHead(f), moved);
    assert.equal(remoteHead(f), f.head);
    const event = lastAuditEvent(f.root);
    assert.equal(event.event, "merged-pr-reconciliation");
    assert.equal(event.cleaned, false);
    assert.equal(event.complete, false);
  } finally {
    f.dispose();
  }
});

test("a completed reconciliation closes the issue, cleans the refs, and records the ledger once", () => {
  const f = makeFixture();
  try {
    const restorePath = withGhStub(f, [f.pr], { state: "OPEN", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
      // A second pass over the same merged PR must not re-close or re-clean.
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      const calls = restorePath();
      const closes = calls
        .split("\n")
        .filter((line) => line.includes("issue close 1")).length;
      assert.equal(closes, 1, `expected exactly one issue close, got:\n${calls}`);
    }
    assert.deepEqual(ledger(f.root), [`${f.pr.number}:${f.head}`]);
    assert.equal(localHead(f), null);
    assert.equal(remoteHead(f), null);
    const event = lastAuditEvent(f.root);
    assert.equal(event.event, "merged-pr-reconciliation");
    assert.equal(event.closed, true);
    assert.equal(event.cleaned, true);
    assert.equal(event.complete, true);
  } finally {
    f.dispose();
  }
});

test("a pending device-evidence issue is held, not closed, and still cleaned", () => {
  const f = makeFixture();
  try {
    const restorePath = withGhStub(
      f,
      [{ ...f.pr, labels: [{ name: "device-evidence-pending" }] }],
      { state: "OPEN", labels: [] },
    );
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      const calls = restorePath();
      assert.ok(!calls.includes("issue close"), `issue must not close:\n${calls}`);
      assert.ok(
        calls.includes("issue edit 1") && calls.includes("ready-for-human"),
        `issue must be held for a human:\n${calls}`,
      );
    }
    assert.deepEqual(ledger(f.root), [`${f.pr.number}:${f.head}`]);
    assert.equal(localHead(f), null);
    assert.equal(remoteHead(f), null);
    const event = lastAuditEvent(f.root);
    assert.equal(event.closed, false);
    assert.equal(event.heldForEvidence, true);
    assert.equal(event.cleaned, true);
    assert.equal(event.complete, true);
  } finally {
    f.dispose();
  }
});

test("a head whose patch changed in the rebase has landed through its merge commit", () => {
  const f = makeFixture();
  try {
    f.git(["reset", "--hard", "HEAD~1"]);
    writeFileSync(join(f.root, "file.txt"), "base\nfixed\nmore\n");
    f.git(["commit", "-am", "Fix ticket, rebased with a changed patch"]);
    const merge = f.git(["rev-parse", "HEAD"]);
    f.git(["push", "--force", "origin", "main"]);
    assert.equal(landedOnMain(f.root, f.pr), false);
    assert.equal(landedOnMain(f.root, { ...f.pr, mergeCommit: { oid: merge } }), true);
    assert.equal(
      landedOnMain(f.root, { ...f.pr, state: "CLOSED", mergeCommit: { oid: merge } }),
      false,
    );
  } finally {
    f.dispose();
  }
});

/**
 * A local clone of a bare origin holding one merged factory ticket that
 * passed through two heads: an earlier head `earlier` and the merged head
 * `head`, both landed on main as patch-equivalent rebase merges. Models a
 * delivery escalated at the earlier head under the old key scheme, then
 * pushed and merged at the later head.
 */
function makeTwoHeadFixture(): Fixture & { readonly earlier: string } {
  const base = mkdtempSync(join(tmpdir(), "sandcastle-factory-host-"));
  const origin = join(base, "origin.git");
  const root = join(base, "root");
  mkdirSync(root);
  gitIn(base, ["init", "--bare", "-b", "main", origin]);
  gitIn(root, ["init", "-b", "main"]);
  gitIn(root, ["remote", "add", "origin", origin]);
  gitIn(root, ["config", "user.email", "factory@example.invalid"]);
  gitIn(root, ["config", "user.name", "Sandcastle Factory"]);
  // The host's global git config may force signed commits; the fixture
  // sets its own signing policy so the check passes on any host.
  gitIn(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "file.txt"), "base\n");
  gitIn(root, ["add", "file.txt"]);
  gitIn(root, ["commit", "-m", "Base commit"]);
  gitIn(root, ["push", "origin", "main"]);
  gitIn(root, ["checkout", "-b", BRANCH]);
  writeFileSync(join(root, "file.txt"), "base\nearlier\n");
  gitIn(root, ["commit", "-am", "Earlier head"]);
  const earlier = gitIn(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "file.txt"), "base\nearlier\nmerged\n");
  gitIn(root, ["commit", "-am", "Merged head"]);
  const head = gitIn(root, ["rev-parse", "HEAD"]);
  gitIn(root, ["push", "origin", BRANCH]);
  gitIn(root, ["checkout", "main"]);
  // Land both heads on main, as a rebase merge of the branch would.
  gitIn(root, ["cherry-pick", earlier]);
  gitIn(root, ["cherry-pick", head]);
  gitIn(root, ["push", "origin", "main"]);
  const pr: MergedFactoryPr = {
    number: 42,
    title: "Merged head",
    body: "Fixes #1",
    url: "https://github.com/rubixhacker/komotion/pull/42",
    state: "MERGED",
    headRefName: BRANCH,
    headRefOid: head,
    baseRefName: "main",
    isCrossRepository: false,
    mergedAt: "2026-11-12T10:00:00Z",
    mergeCommit: null,
    labels: [],
    closingIssuesReferences: [{ number: 1 }],
  };
  return {
    base,
    root,
    head,
    earlier,
    pr,
    git: (args) => gitIn(root, args),
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

function writeReconciledMerges(f: Fixture, entries: readonly string[]): void {
  const path = join(f.root, ".sandcastle/logs/reconciled-merges.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
}

function ciAlertsPath(f: Fixture): string {
  return join(f.root, ".sandcastle/logs/ci-alerts.json");
}

function writeCiAlerts(f: Fixture, entries: readonly string[]): void {
  const path = ciAlertsPath(f);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
}

function readCiAlerts(f: Fixture): string[] {
  try {
    return JSON.parse(readFileSync(ciAlertsPath(f), "utf8"));
  } catch {
    return [];
  }
}

/**
 * Every production-shaped escalation mark a delivery of pull request 42 can
 * leave in the ledger: the merged head and an earlier head, each in the check,
 * the conflict and the cancelled key shape, plus the merged head in the old
 * bare-head shape.
 */
function pr42Marks(f: Fixture): string[] {
  const earlierHead = "e".repeat(40);
  return [
    `pr:42:${earlierHead}`,
    `pr:42:${earlierHead}:conflict`,
    `pr:42:cancelled:${earlierHead}`,
    `pr:42:${f.head}`,
    `pr:42:${f.head}:conflict`,
    `pr:42:cancelled:${f.head}`,
    f.head,
    `${f.head}:conflict`,
  ];
}

test("a merged delivery clears every one of its escalation marks, keeping other pull requests'", () => {
  const f = makeFixture();
  try {
    const otherHead = "f".repeat(40);
    writeCiAlerts(f, [...pr42Marks(f), `pr:99:${otherHead}`, otherHead]);
    const restorePath = withGhStub(f, [f.pr], { state: "OPEN", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      restorePath();
    }
    // Every mark owned by PR 42 is gone; the other pull request's marks survive.
    assert.deepEqual(readCiAlerts(f).sort(), [`pr:99:${otherHead}`, otherHead].sort());
  } finally {
    f.dispose();
  }
});

test("a merged delivery that was the only failed one quiets the gauge", () => {
  const f = makeFixture();
  try {
    writeCiAlerts(f, pr42Marks(f));
    const restorePath = withGhStub(f, [f.pr], { state: "OPEN", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      restorePath();
    }
    assert.deepEqual(readCiAlerts(f), []);
    const logsDir = join(f.root, ".sandcastle/logs");
    const state = deliveryStallState(
      new Date("2026-11-18T12:00:00Z"),
      "2026-11-18T11:00:00Z",
      deliveryFailedCount(logsDir),
    );
    assert.equal(state.stalled, false);
    assert.equal(state.deliveryFailed, false);
    assert.equal(state.noNewDelivery, false);
  } finally {
    f.dispose();
  }
});

test("a blocked cleanup still clears the merged delivery's marks", () => {
  const f = makeFixture();
  try {
    // Move the local head so the branch cleanup is refused.
    f.git(["checkout", BRANCH]);
    writeFileSync(join(f.root, "moved.txt"), "moved\n");
    f.git(["add", "moved.txt"]);
    f.git(["commit", "-m", "Moved local head"]);
    writeCiAlerts(f, pr42Marks(f));
    const restorePath = withGhStub(f, [f.pr], { state: "OPEN", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      restorePath();
    }
    // The cleanup was blocked (not reconciled), but the delivery's marks are
    // still cleared, so the gauge does not latch on a merged delivery.
    assert.deepEqual(ledger(f.root), []);
    assert.deepEqual(readCiAlerts(f), []);
    const state = deliveryStallState(
      new Date("2026-11-18T12:00:00Z"),
      "2026-11-18T11:00:00Z",
      deliveryFailedCount(join(f.root, ".sandcastle/logs")),
    );
    assert.equal(state.stalled, false);
    assert.equal(state.deliveryFailed, false);
  } finally {
    f.dispose();
  }
});

test("a merged delivery whose cleanup threw is not abandoned by the guard", () => {
  const f = makeFixture();
  try {
    // Simulate the state after a cleanup that threw after deleting the refs:
    // both refs are gone, the issue is closed (so it is no longer in the
    // snapshot), and the delivery was never recorded in the reconciliation
    // ledger.
    f.git(["branch", "-D", BRANCH]);
    f.git(["push", "origin", "--delete", BRANCH]);
    writeCiAlerts(f, pr42Marks(f));
    const restorePath = withGhStub(f, [f.pr], { state: "CLOSED", labels: [] });
    try {
      // A second reconciliation pass over the same merged PR must clear the
      // marks and record the delivery, so the gauge does not latch.
      reconcileMergedFactoryPrs(
        f.root,
        { issues: [], prs: [], branches: f.git(["branch", "-a"]) },
      );
    } finally {
      restorePath();
    }
    assert.deepEqual(ledger(f.root), [`${f.pr.number}:${f.head}`]);
    assert.deepEqual(readCiAlerts(f), []);
    const state = deliveryStallState(
      new Date("2026-11-18T12:00:00Z"),
      "2026-11-18T11:00:00Z",
      deliveryFailedCount(join(f.root, ".sandcastle/logs")),
    );
    assert.equal(state.stalled, false);
    assert.equal(state.deliveryFailed, false);
  } finally {
    f.dispose();
  }
});

test("an already-reconciled delivery's old key scheme marks stop counting", () => {
  const f = makeTwoHeadFixture();
  try {
    // The delivery was escalated at its earlier head under the old key
    // scheme (a bare head and a conflict head), plus a cancelled-check mark,
    // and its merge is already recorded in the reconciliation ledger.
    writeReconciledMerges(f, [`${f.pr.number}:${f.head}`]);
    writeCiAlerts(
      f,
      [
        f.earlier,
        `${f.earlier}:conflict`,
        `pr:${f.pr.number}:cancelled:${f.earlier}`,
      ],
    );
    const restorePath = withGhStub(f, [f.pr], { state: "CLOSED", labels: [] });
    try {
      reconcileMergedFactoryPrs(f.root, snapshot(f.git(["branch", "-a"])));
    } finally {
      const calls = restorePath();
      // The reconciliation skips the already-reconciled delivery, so it must
      // not re-close the issue or re-record the ledger.
      assert.ok(!calls.includes("issue close"), `issue must not close:\n${calls}`);
    }
    // The per-pull-request reconciliation skipped the delivery, but the
    // ended-delivery clear still removes every one of its marks, so the
    // failure signal returns to healthy.
    assert.deepEqual(ledger(f.root), [`${f.pr.number}:${f.head}`]);
    assert.deepEqual(readCiAlerts(f), []);
    const state = deliveryStallState(
      new Date("2026-11-18T12:00:00Z"),
      "2026-11-18T11:00:00Z",
      deliveryFailedCount(join(f.root, ".sandcastle/logs")),
    );
    assert.equal(state.stalled, false);
    assert.equal(state.deliveryFailed, false);
    assert.equal(state.noNewDelivery, false);
  } finally {
    f.dispose();
  }
});
