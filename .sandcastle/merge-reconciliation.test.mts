import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type MergeReconciliationContext,
  MergedFactoryPr,
  planMergeReconciliation,
} from "./merge-reconciliation.mjs";

const head = "a".repeat(40);
const merge = "b".repeat(40);

const pr: MergedFactoryPr = {
  number: 42,
  title: "A factory ticket",
  body: "Addresses #2006.",
  url: "https://github.com/rubixhacker/komotion/pull/42",
  state: "MERGED",
  headRefName: "sandcastle/issue-2006",
  headRefOid: head,
  baseRefName: "main",
  isCrossRepository: false,
  mergedAt: "2026-11-12T10:00:00Z",
  mergeCommit: { oid: merge },
  labels: [{ name: "factory" }],
  closingIssuesReferences: [{ number: 2006 }],
};

const safeContext: MergeReconciliationContext = {
  localHead: head,
  remoteHead: head,
  landed: true,
  openPr: false,
  issueOpen: true,
  deviceEvidencePending: false,
  worktreeDirty: false,
};

function plan(
  prOverrides: Partial<MergedFactoryPr> = {},
  contextOverrides: Partial<MergeReconciliationContext> = {},
) {
  return planMergeReconciliation(
    { ...pr, ...prOverrides },
    { ...safeContext, ...contextOverrides },
  );
}

function assertNoDestructiveAction(
  result: ReturnType<typeof planMergeReconciliation>,
  message?: string,
) {
  assert.equal(result.closeIssue, false, message);
  assert.equal(result.cleanup, false, message);
}

test("the GitHub list-entry schema validates merged SHA and required fields", () => {
  const parsed = MergedFactoryPr.parse(pr);
  assert.equal(parsed.mergeCommit?.oid, merge);
  assert.equal(MergedFactoryPr.safeParse({ ...pr, body: undefined }).success, false);
  assert.equal(
    MergedFactoryPr.safeParse({ ...pr, mergeCommit: { oid: "not-a-sha" } })
      .success,
    false,
  );
});

test("a rebase-merged factory PR closes its branch-derived issue and cleans up", () => {
  const result = plan();
  assert.deepEqual(result, {
    issue: 2006,
    mergeSha: merge,
    closeIssue: true,
    cleanup: true,
    reason: "close the issue and clean up the exact landed head",
  });
  assert.notEqual(result.mergeSha, head);
});

test("an open PR owning the same branch blocks every action", () => {
  const result = plan({}, { openPr: true });
  assertNoDestructiveAction(result);
  assert.match(result.reason, /open pull request/);
});

test("a closed-unmerged PR is not reconciled as a merge", () => {
  const result = plan({
    state: "CLOSED",
    mergedAt: null,
    mergeCommit: null,
  });
  assert.equal(result.issue, 2006);
  assert.equal(result.mergeSha, null);
  assertNoDestructiveAction(result);
  assert.match(result.reason, /not merged/);
});

test("a moved or recreated local head blocks every action", () => {
  const result = plan({}, { localHead: "c".repeat(40) });
  assertNoDestructiveAction(result);
  assert.match(result.reason, /local branch/);
});

test("a moved or recreated remote head blocks every action", () => {
  const result = plan({}, { remoteHead: "c".repeat(40) });
  assertNoDestructiveAction(result);
  assert.match(result.reason, /remote branch/);
});

test("an absent branch ref needs no deletion but never blocks a proven merge", () => {
  for (const context of [
    { localHead: null },
    { remoteHead: null },
    { localHead: null, remoteHead: null },
  ] as const) {
    const result = plan({}, context);
    assert.equal(result.closeIssue, true);
    assert.equal(result.cleanup, true);
  }
});

test("a dirty worktree blocks issue closure and cleanup", () => {
  const result = plan({}, { worktreeDirty: true });
  assertNoDestructiveAction(result);
  assert.match(result.reason, /dirty/);
});

test("missing landed ancestry or patch-equivalence proof blocks every action", () => {
  const result = plan({}, { landed: false });
  assertNoDestructiveAction(result);
  assert.match(result.reason, /no landed proof/);
});

test("pending device evidence suppresses closure but permits safe cleanup", () => {
  const result = plan({}, { deviceEvidencePending: true });
  assert.equal(result.closeIssue, false);
  assert.equal(result.cleanup, true);
  assert.match(result.reason, /device evidence is pending/);
});

test("an already closed issue still permits safe cleanup without another closure", () => {
  const result = plan({}, { issueOpen: false });
  assert.equal(result.closeIssue, false);
  assert.equal(result.cleanup, true);
  assert.match(result.reason, /already closed/);
});

test("a merged PR without a merge commit SHA blocks every action", () => {
  const result = plan({ mergeCommit: null });
  assert.equal(result.mergeSha, null);
  assertNoDestructiveAction(result);
  assert.match(result.reason, /merge commit SHA/);
});

test("non-main, cross-repository, open, and malformed factory shapes fail closed", () => {
  const shapes: Array<Partial<MergedFactoryPr>> = [
    { baseRefName: "release/2.5" },
    { isCrossRepository: true },
    { state: "OPEN", mergedAt: null, mergeCommit: null },
    { headRefName: "sandcastle/issue-2006-follow-up" },
    { headRefName: "feature/sandcastle/issue-2006" },
    { headRefName: "sandcastle/issue-2006/" },
    { headRefName: "sandcastle/issue-0" },
  ];

  for (const shape of shapes) {
    const result = plan(shape);
    assertNoDestructiveAction(result, JSON.stringify(shape));
  }
});

test("titles, bodies, labels, and closing references never supply the canonical issue", () => {
  const result = plan({
    headRefName: "contributor/unrelated",
    title: "Fixes #2006",
    body: "Closes #2006",
    labels: [{ name: "sandcastle/issue-2006" }],
    closingIssuesReferences: [{ number: 2006 }],
  });
  assert.equal(result.issue, null);
  assertNoDestructiveAction(result);
  assert.match(result.reason, /exact sandcastle\/issue-N branch/);
});
