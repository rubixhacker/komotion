import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPass, factoryCodeMoved, spacingDelayMs, startDelayMs } from "./drain-policy.mjs";
import type { FactoryStatus } from "./status.mjs";

const startedAt = new Date("2026-11-12T19:39:18.000Z");
const finished = (overrides: Partial<FactoryStatus> = {}): FactoryStatus => ({
  passId: "2026-11-12T19:39:19.000Z",
  phase: "finished",
  ticket: null,
  detail: "",
  startedAt: "2026-11-12T19:39:19.000Z",
  updatedAt: "2026-11-12T19:42:39.000Z",
  finishedAt: "2026-11-12T19:42:39.000Z",
  error: null,
  tickets: {},
  delivered: 0,
  queue: { ready: 12, eligible: 3, heldBack: {} },
  ...overrides,
});
const pass = (overrides: Partial<Parameters<typeof afterPass>[0]> = {}) =>
  afterPass({
    exitCode: 0,
    signal: null,
    status: finished(),
    startedAt,
    branchesBefore: "a refs/heads/sandcastle/issue-1",
    branchesAfter: "a refs/heads/sandcastle/issue-1\nb refs/heads/sandcastle/issue-2",
    ...overrides,
  });

test("a pass that delivered a branch with tickets still eligible earns another", () => {
  assert.deepEqual(pass(), { next: "continue" });
});

test("a pass whose pull requests merged before it ended still earns another", () => {
  // A merged pull request takes its branch with it, so the branch list is unchanged.
  assert.deepEqual(
    pass({
      status: finished({ delivered: 2 }),
      branchesAfter: "a refs/heads/sandcastle/issue-1",
    }),
    { next: "continue" },
  );
});

test("an empty queue, a pass without progress and a held lock each stop the drain cleanly", () => {
  assert.deepEqual(pass({ status: finished({ queue: { ready: 4, eligible: 0, heldBack: {} } }) }), {
    next: "stop",
    reason: "no eligible tickets remain",
    exitCode: 0,
  });
  const idle = pass({ branchesAfter: "a refs/heads/sandcastle/issue-1" });
  assert.equal(idle.next, "stop");
  assert.match(idle.next === "stop" ? idle.reason : "", /3 eligible ticket\(s\) made no progress/);
  assert.deepEqual(pass({ exitCode: 75 }), {
    next: "stop",
    reason: "another pass holds the lock",
    exitCode: 0,
  });
});

test("a failed or killed pass stops the drain with a failing exit", () => {
  assert.deepEqual(pass({ exitCode: 1 }), {
    next: "stop",
    reason: "the pass failed with exit 1",
    exitCode: 1,
  });
  assert.deepEqual(pass({ exitCode: null, signal: "SIGKILL" }), {
    next: "stop",
    reason: "the pass was killed by SIGKILL",
    exitCode: 1,
  });
});

test("a pass that backed off does not start nineteen more", () => {
  // Given: a pass that exited 0 without running because the same failure repeated.
  const step = pass({
    status: finished({ phase: "backing-off", detail: "5 failed passes in a row", error: "boom" }),
  });
  // Then: the drain stops instead of spinning through its pass budget.
  assert.equal(step.next, "stop");
  assert.equal(step.next === "stop" ? step.exitCode : -1, 0);
});

test("a status left by an earlier pass is not read as this pass's result", () => {
  const stale = finished({ startedAt: "2026-11-12T18:00:00.000Z" });
  assert.deepEqual(pass({ status: stale }), {
    next: "stop",
    reason: "the pass recorded no status",
    exitCode: 0,
  });
  assert.equal(pass({ status: null }).next, "stop");
});

test("a status written before the queue summary existed stops rather than loops", () => {
  const { queue: _queue, ...legacy } = finished();
  assert.equal(pass({ status: legacy }).next, "stop");
});

test("a drain woken right after a pass waits out the start spacing", () => {
  const ended = Date.parse(finished().updatedAt);
  assert.equal(startDelayMs(finished(), new Date(ended + 30_000)), 120_000);
  assert.equal(startDelayMs(finished(), new Date(ended + 150_000)), 0);
  assert.equal(startDelayMs(finished(), new Date(ended + 3_600_000)), 0);
  assert.equal(startDelayMs(null, new Date(ended)), 0);
  // A clock that moved backwards must not hold the factory.
  assert.equal(startDelayMs(finished(), new Date(ended - 60_000)), 0);
});

test("a watchdog run woken right after the last one waits out the start spacing", () => {
  assert.equal(spacingDelayMs(null, 1_000_000), 0);
  assert.equal(spacingDelayMs(1_000_000, 1_005_000), 145_000);
  assert.equal(spacingDelayMs(1_000_000, 1_150_000), 0);
  assert.equal(spacingDelayMs(1_000_000, 999_000), 0);
  assert.equal(spacingDelayMs(Number.NaN, 1_000_000), 0);
});

test("a pass stops taking tickets when main holds factory code it did not load", () => {
  assert.equal(factoryCodeMoved("aaa", "bbb", undefined), true);
  assert.equal(factoryCodeMoved("aaa", "aaa", undefined), false);
  // A pinned runtime is meant to differ from main.
  assert.equal(factoryCodeMoved("aaa", "bbb", "1234abc"), false);
  assert.equal(factoryCodeMoved("aaa", "bbb", ""), true);
  // An unreadable tree is no evidence of new code.
  assert.equal(factoryCodeMoved("", "bbb", undefined), false);
  assert.equal(factoryCodeMoved("aaa", "", undefined), false);
});
