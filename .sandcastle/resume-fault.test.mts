import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESUME_FAULT_RETRIES,
  infrastructureFault,
  readResumeFaults,
  resumeFaultDecision,
  writeResumeFaults,
  type ResumeFaults,
} from "./resume-fault.mjs";

const HEAD = "0daf6faba581bba53b4ffd3b56084559026e2429";
const at = new Date("2026-11-19T18:41:00.000Z").toISOString();

test("the classified host faults are the phrases the factory already prints", () => {
  for (const detail of [
    "Sandbox preflight failed: EACCES: permission denied",
    "Agent CLI session lifecycle preflight failed at export: exit 1: no session id",
    "OpenCode model unavailable: anthropic/claude-sonnet",
    "Host review model unavailable: local/qwen",
    "Delivery push preflight failed at push: could not push the probe ref",
    "could not create delivery-push probe worktree: already checked out",
    "opencode exited with code 137:\nKilled",
    "Agent idle for 1800 seconds",
    "Execution failed for task ':androidApp:lintDebug'.\n> Java heap space",
  ]) {
    assert.notEqual(infrastructureFault(detail), null, detail);
  }
});

test("a ticket's own failure is not classified as a host fault", () => {
  for (const detail of [
    "The independent review did not pass: e: Unresolved reference: bar",
    "qualityGate failed: Lint found 2 errors",
    "the planner declined the ticket: out of scope",
    "the branch adds 1 suppression",
    "the agent ended with <promise>BLOCKED</promise> and no commit to deliver",
  ]) {
    assert.equal(infrastructureFault(detail), null, detail);
  }
});

test("an infrastructure fault frees the head; a real failure leaves it marked", () => {
  // Given a retained head that is marked before the resume starts.
  const before = new Set([HEAD]);
  const reason = infrastructureFault("Delivery push preflight failed at push: hook exited 1");
  assert.notEqual(reason, null);

  // When the host fault is classified, the decision releases the head.
  const host = resumeFaultDecision({}, HEAD, reason, at);
  assert.equal(host.releaseHead, true);
  assert.equal(host.count, 1);
  if (host.releaseHead) before.delete(HEAD);
  assert.equal(before.has(HEAD), false);

  // When the failure is the ticket's own, nothing is recorded or released.
  const genuine = resumeFaultDecision({}, HEAD, null, at);
  assert.equal(genuine.releaseHead, false);
  assert.deepEqual(genuine.faults, {});
  const stillMarked = new Set([HEAD]);
  if (genuine.releaseHead) stillMarked.delete(HEAD);
  assert.equal(stillMarked.has(HEAD), true);
});

test("repeats of one reason free the head only a bounded number of times", () => {
  let faults: ResumeFaults = {};
  const reason = infrastructureFault("Sandbox preflight failed: disk error");
  assert.notEqual(reason, null);
  const released: boolean[] = [];
  for (let attempt = 1; attempt <= RESUME_FAULT_RETRIES + 1; attempt += 1) {
    const decision = resumeFaultDecision(faults, HEAD, reason, at, RESUME_FAULT_RETRIES);
    faults = decision.faults;
    released.push(decision.releaseHead);
  }
  assert.deepEqual(released, [
    ...Array.from({ length: RESUME_FAULT_RETRIES }, () => true),
    false,
  ]);
  // After the bound the head stays marked, so the next pass hands it to a human.
  assert.equal(faults[HEAD]?.count, RESUME_FAULT_RETRIES + 1);
  assert.equal(faults[HEAD]?.reason, reason);
});

test("a different host reason gets a fresh allowance on the same head", () => {
  const first = "Sandbox preflight failed: disk error";
  const second = "Delivery push preflight failed at push: checkout contention";
  let faults = resumeFaultDecision({}, HEAD, infrastructureFault(first), at).faults;
  faults = resumeFaultDecision(faults, HEAD, infrastructureFault(first), at).faults;
  assert.equal(faults[HEAD]?.count, 2);
  const decision = resumeFaultDecision(faults, HEAD, infrastructureFault(second), at);
  assert.equal(decision.releaseHead, true);
  assert.equal(decision.faults[HEAD]?.count, 1);
  assert.equal(decision.faults[HEAD]?.reason, infrastructureFault(second));
});

test("the fault ledger round-trips and an unreadable file is empty", () => {
  const path = join(mkdtempSync(join(tmpdir(), "resume-fault-")), "resume-faults.json");
  assert.deepEqual(readResumeFaults(path), {});
  const faults = resumeFaultDecision({}, HEAD, "Sandbox preflight failed", at).faults;
  writeResumeFaults(path, faults);
  assert.deepEqual(readResumeFaults(path), faults);
});
