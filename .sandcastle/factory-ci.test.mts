import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideCi,
  failingChecks,
  failingRunIds,
  green,
  ownsFactoryPr,
  passedChecks,
  settled,
  skippedChecks,
  type FactoryPr,
} from "./factory-ci.mjs";

function checkRun(name: string, status: string, conclusion: string | null) {
  return {
    __typename: "CheckRun" as const,
    name,
    workflowName: "CI",
    status,
    conclusion,
    detailsUrl: "https://example.test/job/1",
  };
}

function pr(overrides: Partial<FactoryPr> = {}): FactoryPr {
  return {
    number: 1627,
    headRefName: "sandcastle/issue-1593",
    headRefOid: "a7b91c10cdc661fe85cabb9d49bab80d206477d9",
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    statusCheckRollup: [checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS")],
    ...overrides,
  };
}

test("ownsOnlyItsOwnOpenIssueBranches", () => {
  assert.equal(ownsFactoryPr(pr()), true);
  assert.equal(ownsFactoryPr(pr({ headRefName: "dependabot/npm/left-pad" })), false);
  assert.equal(ownsFactoryPr(pr({ headRefName: "sandcastle/preflight-1" })), false);
  assert.equal(ownsFactoryPr(pr({ state: "MERGED" })), false);
  assert.equal(ownsFactoryPr(pr({ isDraft: true })), false);
  assert.equal(ownsFactoryPr(pr({ isCrossRepository: true })), false);
  assert.equal(ownsFactoryPr(pr({ baseRefName: "release" })), false);
});

test("reportsOnlyTerminalFailures", () => {
  const failing = pr({
    statusCheckRollup: [
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
      checkRun("android-build", "COMPLETED", "FAILURE"),
      checkRun("contracts", "IN_PROGRESS", null),
    ],
  });
  assert.equal(failingChecks(failing).length, 1);
  assert.equal(failingChecks(failing)[0]?.name, "android-build");
});

test("skippedNeutralAndStaleChecksAreTheCompletedOnesWithoutAVerdict", () => {
  const mixed = pr({
    statusCheckRollup: [
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
      checkRun("iOS Build", "COMPLETED", "SKIPPED"),
      checkRun("contracts", "COMPLETED", "NEUTRAL"),
      checkRun("android-build", "COMPLETED", "STALE"),
      checkRun("in-flight", "IN_PROGRESS", null),
      checkRun("external", "COMPLETED", "CANCELLED"),
    ],
  });
  assert.deepEqual(
    skippedChecks(mixed).map((check) => check.name),
    ["iOS Build", "contracts", "android-build"],
  );
  assert.deepEqual(passedChecks(mixed).map((check) => check.name), ["Lint & Code Quality"]);
});

test("the runs to re-run are those behind failing checks, each once", () => {
  const run = (id: number) =>
    `https://github.com/rubixhacker/komotion/actions/runs/${id}/job/1`;
  const failing = pr({
    statusCheckRollup: [
      { ...checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"), detailsUrl: run(1) },
      { ...checkRun("android-build", "COMPLETED", "FAILURE"), detailsUrl: run(2) },
      { ...checkRun("contracts", "COMPLETED", "FAILURE"), detailsUrl: run(2) },
      { ...checkRun("iOS Quick Build Check", "COMPLETED", "FAILURE"), detailsUrl: run(3) },
      { ...checkRun("external", "COMPLETED", "FAILURE"), detailsUrl: "https://example.com/x" },
    ],
  });
  assert.deepEqual(failingRunIds(failing), ["2", "3"]);
});

test("pendingChecksKeepThePrUnsettled", () => {
  const pending = pr({
    statusCheckRollup: [
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
      checkRun("android-build", "IN_PROGRESS", null),
    ],
  });
  assert.equal(settled(pending), false);
  assert.equal(green(pending), false);
  assert.equal(decideCi(pending, 0, 3), "wait");
});

test("skippedStillCountsAsSettledButNotGreen", () => {
  const skipped = pr({
    statusCheckRollup: [checkRun("iOS Build", "COMPLETED", "SKIPPED")],
  });
  assert.equal(settled(skipped), true);
  assert.equal(green(skipped), false);
});

test("greenRequiresEveryCheckToSucceed", () => {
  const passing = pr({
    statusCheckRollup: [
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
      checkRun("android-build", "COMPLETED", "SUCCESS"),
    ],
  });
  assert.equal(green(passing), true);
  assert.equal(decideCi(passing, 0, 3), "green");
  const skipped = pr({
    statusCheckRollup: [
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
      checkRun("iOS Build", "COMPLETED", "SKIPPED"),
    ],
  });
  assert.equal(green(skipped), false);
  assert.equal(decideCi(skipped, 0, 3), "wait");
});

test("repairsFailuresUntilTheAttemptBudgetIsSpent", () => {
  const failing = pr({
    statusCheckRollup: [
      checkRun("android-build", "COMPLETED", "FAILURE"),
      checkRun("Lint & Code Quality", "COMPLETED", "SUCCESS"),
    ],
  });
  assert.equal(decideCi(failing, 0, 3), "repair");
  assert.equal(decideCi(failing, 2, 3), "repair");
  assert.equal(decideCi(failing, 3, 3), "failed");
});

test("conflictsCountAsRepairWork", () => {
  const conflicting = pr({ mergeable: "CONFLICTING" });
  assert.equal(decideCi(conflicting, 0, 3), "repair");
  assert.equal(decideCi(conflicting, 3, 3), "failed");
});

test("foreignPrsAreNeverTouched", () => {
  const foreign = pr({ headRefName: "feature/someone-else" });
  assert.equal(decideCi(foreign, 0, 3), "wait");
});
