import { test } from "node:test";
import assert from "node:assert/strict";
import { planCancelledChecks, selectFailedFactoryPrs } from "./factory-prs.mjs";

const base = {
  title: "A ticket",
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  state: "OPEN" as const,
  isDraft: false,
  isCrossRepository: false,
  mergeable: "MERGEABLE" as const,
  mergeStateStatus: "CLEAN",
};

const check = (name: string, conclusion: string) => ({
  __typename: "CheckRun" as const,
  workflowName: "CI",
  name,
  status: "COMPLETED",
  conclusion,
});

test("a factory pull request with a failing check is selected", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 42,
      headRefName: "sandcastle/issue-2006",
      statusCheckRollup: [check("Lint & Code Quality", "SUCCESS"), check("iOS Quick Build Check", "FAILURE")],
    },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.pr.number, 42);
  assert.equal(selected[0]?.issue, 2006);
});

test("a factory pull request whose checks are green is not selected", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 42,
      headRefName: "sandcastle/issue-2006",
      statusCheckRollup: [check("Lint & Code Quality", "SUCCESS")],
    },
  ]);
  assert.deepEqual(selected, []);
});

test("a pull request on another branch is left alone", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 43,
      headRefName: "dependabot/gradle/library",
      statusCheckRollup: [check("iOS Quick Build Check", "FAILURE")],
    },
    {
      ...base,
      number: 44,
      headRefName: "feature/someone-else",
      statusCheckRollup: [check("iOS Quick Build Check", "FAILURE")],
    },
  ]);
  assert.deepEqual(selected, []);
});

test("a pull request that is not the factory's own is left alone", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 45,
      headRefName: "sandcastle/issue-2006",
      isDraft: true,
      statusCheckRollup: [check("iOS Quick Build Check", "FAILURE")],
    },
    {
      ...base,
      number: 46,
      headRefName: "sandcastle/issue-2007",
      baseRefName: "release/2.5",
      statusCheckRollup: [check("iOS Quick Build Check", "FAILURE")],
    },
    {
      ...base,
      number: 47,
      headRefName: "sandcastle/issue-2008",
      isCrossRepository: true,
      statusCheckRollup: [check("iOS Quick Build Check", "FAILURE")],
    },
  ]);
  assert.deepEqual(selected, []);
});

test("a check that has not reached a conclusion is not a failure", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 48,
      headRefName: "sandcastle/issue-2006",
      statusCheckRollup: [
        { __typename: "CheckRun" as const, name: "iOS Quick Build Check", status: "IN_PROGRESS" },
        { __typename: "StatusContext" as const, context: "android-build", state: "PENDING" },
      ],
    },
  ]);
  assert.deepEqual(selected, []);
});

test("a green pull request that conflicts with main is selected as a conflict", () => {
  const selected = selectFailedFactoryPrs([
    {
      ...base,
      number: 49,
      headRefName: "sandcastle/issue-2131",
      mergeable: "CONFLICTING" as const,
      statusCheckRollup: [check("Lint & Code Quality", "SUCCESS")],
    },
    {
      ...base,
      number: 50,
      headRefName: "sandcastle/issue-2132",
      mergeable: "UNKNOWN" as const,
      statusCheckRollup: [check("Lint & Code Quality", "SUCCESS")],
    },
  ]);
  assert.deepEqual(
    selected.map((entry) => [entry.pr.number, entry.conflict]),
    [[49, true]],
  );
});

const cancelled = {
  ...check("iOS Quick Build Check", "CANCELLED"),
  detailsUrl: "https://github.com/o/r/actions/runs/777/job/1",
};
const timedOut = {
  ...base,
  number: 50,
  headRefName: "sandcastle/issue-2010",
  statusCheckRollup: [check("Lint & Code Quality", "SUCCESS"), cancelled],
};
const RERUN = `pr:50:rerun-cancelled:${"a".repeat(40)}`;
const ALERT = `pr:50:cancelled:${"a".repeat(40)}`;

test("a head stuck on a cancelled check is re-run once, then a human is told once", () => {
  // A cancelled check is not a failed one, so the repair sweep does not see it.
  assert.deepEqual(selectFailedFactoryPrs([timedOut]), []);

  const first = planCancelledChecks([timedOut], new Set(), new Set());
  assert.deepEqual(first.map((action) => [action.kind, action.key]), [["rerun", RERUN]]);

  const second = planCancelledChecks([timedOut], new Set([RERUN]), new Set());
  assert.deepEqual(second.map((action) => [action.kind, action.key]), [["escalate", ALERT]]);
  assert.equal(second[0]?.kind === "escalate" && second[0].issue, 2010);

  assert.deepEqual(planCancelledChecks([timedOut], new Set([RERUN]), new Set([ALERT])), []);
});

test("a cancelled check is left alone while another runs, fails, or the branch conflicts", () => {
  const running = { ...check("android-build", "SUCCESS"), status: "IN_PROGRESS", conclusion: null };
  const none = (pr: Parameters<typeof planCancelledChecks>[0][number]) =>
    assert.deepEqual(planCancelledChecks([pr], new Set(), new Set()), []);
  none({ ...timedOut, statusCheckRollup: [cancelled, running] });
  none({ ...timedOut, statusCheckRollup: [cancelled, check("android-build", "FAILURE")] });
  none({ ...timedOut, mergeable: "CONFLICTING" as const });
  none({ ...timedOut, headRefName: "feature/someone-elses" });
  none({ ...timedOut, statusCheckRollup: [check("Lint & Code Quality", "SUCCESS")] });
});
