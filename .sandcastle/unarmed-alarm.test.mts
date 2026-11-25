import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PullRequest } from "./queue.mjs";
import {
  claimedByOtherPr,
  planUnarmedAlarm,
  readUnarmedStreaks,
  type UnarmedCandidate,
  type UnarmedStreaks,
  unarmedKey,
  unarmedLedgerPath,
  writeUnarmedStreaks,
} from "./unarmed-alarm.mjs";

function candidate(overrides: Partial<UnarmedCandidate> = {}): UnarmedCandidate {
  return {
    pr: 42,
    issue: 7,
    head: "a".repeat(40),
    evidencePending: false,
    claimedByOtherPr: false,
    armed: false,
    ...overrides,
  };
}

function otherPr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 99,
    title: "Unrelated change",
    body: "No issue link",
    headRefName: "feature/unrelated",
    closingIssuesReferences: [],
    ...overrides,
  };
}

test("an unexplained head alarms once after the configured number of sweeps", () => {
  const pr = candidate();
  const key = unarmedKey(pr.pr, pr.head);

  const first = planUnarmedAlarm([pr], {}, 3);
  assert.equal(first.plans[0]?.alarm, false);
  assert.equal(first.plans[0]?.sweeps, 1);

  const second = planUnarmedAlarm([pr], first.streaks, 3);
  assert.equal(second.plans[0]?.alarm, false);
  assert.equal(second.plans[0]?.sweeps, 2);

  const third = planUnarmedAlarm([pr], second.streaks, 3);
  assert.equal(third.plans[0]?.alarm, true);
  assert.equal(third.plans[0]?.sweeps, 3);
  assert.deepEqual(third.streaks[key], { sweeps: 3, alarmed: true });

  const fourth = planUnarmedAlarm([pr], third.streaks, 3);
  assert.equal(fourth.plans[0]?.alarm, false);
  assert.equal(fourth.plans[0]?.sweeps, 4);
});

test("pending device evidence suppresses the alarm and clears a started streak", () => {
  const pr = candidate();
  const held = candidate({ evidencePending: true });
  const started = planUnarmedAlarm([pr], {}, 1).streaks;

  const result = planUnarmedAlarm([held], started, 1);
  assert.equal(result.plans[0]?.alarm, false);
  assert.equal(result.plans[0]?.sweeps, 0);
  assert.deepEqual(result.streaks, {});
});

test("a claim by another open PR suppresses the alarm and clears a started streak", () => {
  const pr = candidate();
  const claimed = candidate({ claimedByOtherPr: true });
  const started = planUnarmedAlarm([pr], {}, 1).streaks;

  const result = planUnarmedAlarm([claimed], started, 1);
  assert.equal(result.plans[0]?.alarm, false);
  assert.equal(result.plans[0]?.sweeps, 0);
  assert.deepEqual(result.streaks, {});
});

test("an armed head clears its streak instead of counting a sweep", () => {
  const pr = candidate();
  const started = planUnarmedAlarm([pr], {}, 1).streaks;

  const result = planUnarmedAlarm([candidate({ armed: true })], started, 1);
  assert.equal(result.plans[0]?.alarm, false);
  assert.deepEqual(result.streaks, {});
});

test("a new head starts a fresh grace window and the old streak is dropped", () => {
  const pr = candidate();
  const started = planUnarmedAlarm([pr], {}, 2).streaks;
  const moved = candidate({ head: "b".repeat(40) });

  const result = planUnarmedAlarm([moved], started, 2);
  assert.equal(result.plans[0]?.sweeps, 1);
  assert.equal(result.plans[0]?.alarm, false);
  assert.deepEqual(Object.keys(result.streaks), [unarmedKey(moved.pr, moved.head)]);
});

test("a head absent from a sweep leaves no stale streak behind", () => {
  const pr = candidate();
  const started = planUnarmedAlarm([pr], {}, 1).streaks;

  const result = planUnarmedAlarm([], started, 1);
  assert.deepEqual(result.plans, []);
  assert.deepEqual(result.streaks, {});
});

test("an owned delivery's own branch never counts as another PR's claim", () => {
  const self = otherPr({
    number: 42,
    headRefName: "sandcastle/issue-7",
    title: "Fixes #7",
    closingIssuesReferences: [{ number: 7 }],
  });
  assert.equal(claimedByOtherPr([self], 42, 7), false);
});

test("a claim by title, body, closing reference, or branch is detected", () => {
  assert.equal(claimedByOtherPr([otherPr({ title: "Fix #7" })], 42, 7), true);
  assert.equal(claimedByOtherPr([otherPr({ body: "Closes /issues/7" })], 42, 7), true);
  assert.equal(
    claimedByOtherPr([otherPr({ closingIssuesReferences: [{ number: 7 }] })], 42, 7),
    true,
  );
  assert.equal(
    claimedByOtherPr([otherPr({ headRefName: "sandcastle/issue-7" })], 42, 7),
    true,
  );
  assert.equal(claimedByOtherPr([otherPr()], 42, 7), false);
  assert.equal(claimedByOtherPr([otherPr({ title: "Fix #70" })], 42, 7), false);
});

test("the unarmed streak ledger round-trips through its file", () => {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-unarmed-"));
  try {
    const path = unarmedLedgerPath(dir);
    assert.deepEqual(readUnarmedStreaks(path), {});
    const streaks: UnarmedStreaks = { [unarmedKey(42, "a".repeat(40))]: { sweeps: 2, alarmed: false } };
    writeUnarmedStreaks(path, streaks);
    assert.deepEqual(readUnarmedStreaks(path), streaks);
    assert.ok(readFileSync(path, "utf8").includes("alarmed"));
    writeFileSync(path, "not json");
    assert.deepEqual(readUnarmedStreaks(path), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
