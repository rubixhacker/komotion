import assert from "node:assert/strict";
import test from "node:test";
import { failingTestNames, targetedRepairContext } from "./targeted-repair.mjs";

test("failing test names come from XCTest and Gradle failure lines, once each", () => {
  const log = [
    "FAILED MetabolismProfileTests.testLifestyleFactorsMoveTheLiveHalfLifePreviewAndToggleBack()",
    "Test Case '-[iosAppTests.UnfinishedCaptureOutcomeTests testCompletedOutcomeShowsTheLoggedResultAndUndoDeletesItsConsumption]' started.",
    "testUndoRetainsLoggedResolutionAndTargetsExactConsumption FAILED",
    "FAILED MetabolismProfileTests.testLifestyleFactorsMoveTheLiveHalfLifePreviewAndToggleBack()",
    "ios-checks: 1 failed test case",
  ].join("\n");
  assert.deepEqual(failingTestNames(log), [
    "MetabolismProfileTests.testLifestyleFactorsMoveTheLiveHalfLifePreviewAndToggleBack",
    "testCompletedOutcomeShowsTheLoggedResultAndUndoDeletesItsConsumption",
    "testUndoRetainsLoggedResolutionAndTargetsExactConsumption",
  ]);
});

test("a clean log has no named tests", () => {
  assert.deepEqual(failingTestNames("all checks passed"), []);
});

test("a targeted brief keeps the failure and adds the named contracts", () => {
  const text = targetedRepairContext("FAILED FooTests.testBar", {
    tests: ["FooTests.testBar"],
    docs: ["contracts/capture-action-truth-table.json", "docs/adr/0047-something.md"],
  });
  assert.match(text, /FAILED FooTests\.testBar/);
  assert.match(text, /TARGETED SECOND ATTEMPT/);
  assert.match(text, /- FooTests\.testBar/);
  assert.match(text, /- contracts\/capture-action-truth-table\.json/);
  assert.match(text, /- docs\/adr\/0047-something\.md/);
  assert.match(text, /fix the test to the durable contract/);
  assert.match(text, /emit BLOCKED/);
});
