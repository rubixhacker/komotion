import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoMergeArmed,
  autoMergeDecision,
  currentHumanApproval,
  type GithubReview,
} from "./factory-delivery.mjs";
import type { FactoryPr } from "./factory-ci.mjs";
import { EXPECTED_CHECKS } from "./dependabot-policy.mjs";

function check(
  [workflowName, name]: readonly [string, string],
  conclusion = "SUCCESS",
) {
  return {
    __typename: "CheckRun" as const,
    workflowName,
    name,
    status: "COMPLETED",
    conclusion,
    detailsUrl: "https://example.test/check/1",
  };
}

function factoryPr(overrides: Partial<FactoryPr> = {}): FactoryPr {
  return {
    number: 42,
    headRefName: "sandcastle/issue-42",
    headRefOid: "a".repeat(40),
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: EXPECTED_CHECKS.map((expected) => check(expected)),
    labels: [],
    ...overrides,
  };
}

function approval(overrides: Partial<GithubReview> = {}): GithubReview {
  return {
    id: 1,
    state: "APPROVED",
    commit_id: "a".repeat(40),
    submitted_at: "2026-11-12T12:00:00Z",
    author_association: "OWNER",
    user: { login: "stewart", type: "User" },
    ...overrides,
  };
}

test("the default policy arms a green head without a human approval", () => {
  assert.deepEqual(autoMergeDecision(factoryPr(), []), { action: "arm" });
});

test("an authorized human approval at the exact green head arms rebase auto-merge", () => {
  assert.deepEqual(autoMergeDecision(factoryPr(), [approval()], "approval"), { action: "arm" });
});

test("an old-head or bot approval never arms merge", () => {
  const oldHead = approval({ commit_id: "b".repeat(40) });
  assert.equal(currentHumanApproval([oldHead], "a".repeat(40)), false);
  const bot = approval({ user: { login: "review-bot[bot]", type: "Bot" } });
  assert.equal(autoMergeDecision(factoryPr(), [bot], "approval").action, "wait");
  const outside = approval({ author_association: "NONE" });
  assert.equal(autoMergeDecision(factoryPr(), [outside], "approval").action, "wait");
});

test("a later changes request or dismissal supersedes an earlier approval", () => {
  const changed = approval({
    id: 2,
    state: "CHANGES_REQUESTED",
    submitted_at: "2026-11-12T12:01:00Z",
  });
  assert.equal(currentHumanApproval([approval(), changed], "a".repeat(40)), false);
  assert.equal(
    currentHumanApproval(
      [changed, approval({ id: 3, submitted_at: "2026-11-12T12:02:00Z" })],
      "a".repeat(40),
    ),
    true,
  );
  assert.equal(
    currentHumanApproval(
      [approval({ id: 3, state: "DISMISSED", submitted_at: "2026-11-12T12:02:00Z" })],
      "a".repeat(40),
    ),
    false,
  );
});

test("comments preserve the latest substantive approval", () => {
  const comment = approval({ id: 2, state: "COMMENTED", submitted_at: "2026-11-12T12:03:00Z" });
  assert.equal(currentHumanApproval([approval(), comment], "a".repeat(40)), true);
});

test("missing required checks and non-clean merge state never arm", () => {
  const missingCheck = factoryPr({
    statusCheckRollup: [check(EXPECTED_CHECKS[0])],
  });
  assert.equal(autoMergeDecision(missingCheck, [approval()], "approval").action, "wait");
  const pending = factoryPr({ mergeStateStatus: "BLOCKED" });
  assert.equal(autoMergeDecision(pending, [approval()], "approval").action, "wait");
  const headMoved = factoryPr({ headRefOid: "b".repeat(40) });
  assert.equal(autoMergeDecision(headMoved, [approval()], "approval").action, "wait");
});

test("a merged PR or rebase-armed PR is reconciled as complete", () => {
  assert.equal(autoMergeArmed({ state: "MERGED", autoMergeRequest: null }), true);
  assert.equal(
    autoMergeArmed({ state: "OPEN", autoMergeRequest: { mergeMethod: "REBASE" } }),
    true,
  );
  assert.equal(
    autoMergeArmed({ state: "OPEN", autoMergeRequest: { mergeMethod: "MERGE" } }),
    false,
  );
  assert.equal(autoMergeArmed({ state: "OPEN", autoMergeRequest: null }), false);
});

test("the green policy arms a green clean head without a human approval", () => {
  assert.deepEqual(autoMergeDecision(factoryPr(), [], "green"), { action: "arm" });
});

test("the green policy helper needs no human approval; the arm-merge trust bar enforces checks and cleanliness", () => {
  // autoMergeDecision owns only the ownership, evidence and approval split. Green
  // required checks, clean mergeability and current-main ancestry are enforced
  // at arm time by armMergeDecision in arm-merge.mts under both policies.
  const red = factoryPr({
    statusCheckRollup: EXPECTED_CHECKS.map((expected, i) =>
      check(expected, i === 0 ? "FAILURE" : "SUCCESS"),
    ),
  });
  assert.deepEqual(autoMergeDecision(red, [], "green"), { action: "arm" });
  assert.deepEqual(
    autoMergeDecision(factoryPr({ mergeStateStatus: "BLOCKED" }), [], "green"),
    { action: "arm" },
  );
  assert.deepEqual(
    autoMergeDecision(factoryPr({ mergeStateStatus: "DIRTY" }), [], "green"),
    { action: "arm" },
  );
  // A non-factory PR or a draft still waits: ownsFactoryPr owns those gates.
  assert.equal(autoMergeDecision(factoryPr({ isDraft: true }), [], "green").action, "wait");
});

test("a pending-evidence delivery waits under either policy", () => {
  const pending = factoryPr({ labels: [{ name: "device-evidence-pending" }] });
  assert.equal(autoMergeDecision(pending, [], "green").action, "wait");
  assert.equal(autoMergeDecision(pending, [approval()], "approval").action, "wait");
});
