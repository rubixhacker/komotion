import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRepairMark,
  MAX_CHECK_REPAIRS_PER_PR,
  noRebaseCommitEscalation,
  planCiSweep,
} from "./ci-sweep.mjs";

const head = "a".repeat(40);
const entry = { prNumber: 42, issue: 2006, head, conflict: false };
/** What the ledger holds once this request's head has had its check repair. */
const repairedMark = checkRepairMark(42, head);
/** The ci-alerts key a request's head is escalated under: the head, prefixed by the pull request. */
const alertKey = (prNumber: number, h: string, conflict = false) =>
  conflict ? `pr:${prNumber}:${h}:conflict` : `pr:${prNumber}:${h}`;

test("a failing request that was never repaired is repaired", () => {
  assert.deepEqual(planCiSweep([entry], new Set(), new Set()), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "repair" },
  ]);
});

test("a head that was already repaired is escalated to a human", () => {
  assert.deepEqual(planCiSweep([entry], new Set([repairedMark]), new Set()), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "escalate" },
  ]);
});

test("a head that was escalated is left alone, so the alert fires once", () => {
  assert.deepEqual(
    planCiSweep([entry], new Set([repairedMark]), new Set([alertKey(42, head)])),
    [{ ...entry, key: alertKey(42, head), attemptMark: head, kind: "skip" }],
  );
});

test("a new push earns a fresh repair after an escalation", () => {
  const pushed = { ...entry, head: "b".repeat(40) };
  assert.deepEqual(
    planCiSweep([pushed], new Set([repairedMark]), new Set([alertKey(42, head)])),
    [{ ...pushed, key: alertKey(42, pushed.head), attemptMark: pushed.head, kind: "repair" }],
  );
});

test("every failing request is decided independently", () => {
  const other = { prNumber: 43, issue: 2007, head: "c".repeat(40), conflict: false };
  assert.deepEqual(
    planCiSweep([entry, other], new Set([repairedMark]), new Set()),
    [
      { ...entry, key: alertKey(42, head), attemptMark: head, kind: "escalate" },
      { ...other, key: alertKey(43, other.head), attemptMark: other.head, kind: "repair" },
    ],
  );
});

test("a conflicting request is rebased, even when its check repair is spent", () => {
  const conflicting = { ...entry, conflict: true };
  assert.deepEqual(
    planCiSweep([conflicting], new Set([repairedMark]), new Set()),
    [
      {
        ...conflicting,
        key: alertKey(42, head, true),
        attemptMark: `${head}:conflict`,
        kind: "rebase",
      },
    ],
  );
});

test("a rebase that did not help is escalated once", () => {
  const conflicting = { ...entry, conflict: true };
  const rebaseMark = `${head}:conflict`;
  const key = alertKey(42, head, true);
  assert.deepEqual(planCiSweep([conflicting], new Set([rebaseMark]), new Set()), [
    { ...conflicting, key, attemptMark: rebaseMark, kind: "escalate" },
  ]);
  assert.deepEqual(planCiSweep([conflicting], new Set([rebaseMark]), new Set([key])), [
    { ...conflicting, key, attemptMark: rebaseMark, kind: "skip" },
  ]);
});

test("a request whose repairs keep failing is escalated once its repairs are spent", () => {
  const spent = new Set(
    Array.from({ length: MAX_CHECK_REPAIRS_PER_PR }, (_, n) =>
      checkRepairMark(entry.prNumber, String(n).repeat(40)),
    ),
  );
  assert.deepEqual(planCiSweep([entry], spent, new Set()), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "escalate" },
  ]);
  assert.deepEqual(planCiSweep([entry], spent, new Set([alertKey(42, head)])), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "skip" },
  ]);
});

test("another request's repairs do not count against this one", () => {
  const spent = new Set(
    Array.from({ length: MAX_CHECK_REPAIRS_PER_PR }, (_, n) =>
      checkRepairMark(99, String(n).repeat(40)),
    ),
  );
  assert.deepEqual(planCiSweep([entry], spent, new Set()), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "repair" },
  ]);
});

test("spent check repairs still leave a conflicting request its rebase", () => {
  const conflicting = { ...entry, conflict: true };
  const spent = new Set(
    Array.from({ length: MAX_CHECK_REPAIRS_PER_PR }, (_, n) =>
      checkRepairMark(entry.prNumber, String(n).repeat(40)),
    ),
  );
  assert.deepEqual(planCiSweep([conflicting], spent, new Set()), [
    {
      ...conflicting,
      key: alertKey(42, head, true),
      attemptMark: `${head}:conflict`,
      kind: "rebase",
    },
  ]);
});

test("a kept branch's resume does not count as its pull request's check repair", () => {
  // The author's resume records the bare head in the same ledger. A resumed
  // branch delivered unchanged still has its one repair to spend.
  assert.deepEqual(planCiSweep([entry], new Set([head]), new Set()), [
    { ...entry, key: alertKey(42, head), attemptMark: head, kind: "repair" },
  ]);
});

test("a rebase that produced no commit escalates under the conflict key", () => {
  const escalation = noRebaseCommitEscalation(42, 2006, head, "sandcastle/issue-2006");
  assert.equal(escalation.key, alertKey(42, head, true));
  assert.match(escalation.message, /#42/);
  assert.match(escalation.message, /issue #2006/);
  assert.match(escalation.message, /conflicts with main/);
  assert.match(escalation.message, /sandcastle\/issue-2006/);
  assert.match(escalation.message, /no commit/);
});

test("the no-commit escalation uses a fresh key for a new head", () => {
  const other = "b".repeat(40);
  assert.notEqual(
    noRebaseCommitEscalation(42, 2006, head, "b").key,
    noRebaseCommitEscalation(42, 2006, other, "b").key,
  );
});
