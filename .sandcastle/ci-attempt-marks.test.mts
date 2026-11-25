import { test } from "node:test";
import assert from "node:assert/strict";
import { CiAttemptMarks, type CiMarkLedger } from "./ci-attempt-marks.mjs";
import { checkRepairMark, planCiSweep } from "./ci-sweep.mjs";

const HEAD = "a".repeat(40);

class MemoryLedger implements CiMarkLedger {
  readonly heads = new Set<string>();
  readonly forgotten: string[] = [];

  add(mark: string): void {
    this.heads.add(mark);
  }

  forget(mark: string): void {
    this.heads.delete(mark);
    this.forgotten.push(mark);
  }
}

test("a deliberate stop releases an in-flight rebase mark, so the next sweep rebases again", async () => {
  const ledger = new MemoryLedger();
  const marks = new CiAttemptMarks(ledger);
  let finishAgent = () => {};
  const agent = new Promise<void>((resolve) => {
    finishAgent = resolve;
  });
  const attemptMark = `${HEAD}:conflict`;
  const running = marks.run([attemptMark], () => agent);

  // The mark is recorded before the rebase agent starts.
  assert.deepEqual([...ledger.heads], [attemptMark]);

  // The operator stops the factory while the agent is still in flight.
  marks.releaseOnStop();
  assert.deepEqual(ledger.forgotten, [attemptMark]);
  assert.deepEqual([...ledger.heads], []);
  const [action] = planCiSweep(
    [{ prNumber: 42, issue: 2443, head: HEAD, conflict: true }],
    ledger.heads,
    new Set(),
  );
  assert.equal(action?.kind, "rebase");

  // A second stop, or the killed agent ending later, must not forget it twice.
  finishAgent();
  await running;
  marks.releaseOnStop();
  assert.deepEqual(ledger.forgotten, [attemptMark]);
});

test("a stop releases both marks of an in-flight check repair", async () => {
  const ledger = new MemoryLedger();
  const marks = new CiAttemptMarks(ledger);
  let finishAgent = () => {};
  const agent = new Promise<void>((resolve) => {
    finishAgent = resolve;
  });
  const attemptMark = HEAD;
  const repairMark = checkRepairMark(42, HEAD);
  const running = marks.run([attemptMark, repairMark], () => agent);
  assert.deepEqual([...ledger.heads], [attemptMark, repairMark]);

  marks.releaseOnStop();
  assert.deepEqual([...ledger.heads], []);
  const [action] = planCiSweep(
    [{ prNumber: 42, issue: 2443, head: HEAD, conflict: false }],
    ledger.heads,
    new Set(),
  );
  assert.equal(action?.kind, "repair");

  finishAgent();
  await running;
});

test("a genuine crash consumes the mark, so a broken repair cannot retry forever", async () => {
  const ledger = new MemoryLedger();
  const marks = new CiAttemptMarks(ledger);
  const attemptMark = HEAD;
  const repairMark = checkRepairMark(42, HEAD);

  await assert.rejects(
    marks.run([attemptMark, repairMark], async () => {
      throw new Error("agent process died");
    }),
    /agent process died/u,
  );

  // No stop signal arrived: the crashed run still spent the head's attempt.
  assert.deepEqual([...ledger.heads], [attemptMark, repairMark]);
  const [action] = planCiSweep(
    [{ prNumber: 42, issue: 2443, head: HEAD, conflict: false }],
    ledger.heads,
    new Set(),
  );
  assert.equal(action?.kind, "escalate");

  // A later stop cannot un-spend an attempt that genuinely ended.
  marks.releaseOnStop();
  assert.deepEqual(ledger.forgotten, []);
  assert.deepEqual([...ledger.heads], [attemptMark, repairMark]);
});
