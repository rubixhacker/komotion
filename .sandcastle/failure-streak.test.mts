import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_STREAK_POLICY,
  afterFailure,
  failureFingerprint,
  failureMessage,
  readStreaks,
  recordFailure,
  recordSuccess,
  retryAfter,
  retryAfterIn,
  streakNeedsAlert,
} from "./failure-streak.mjs";

const HEAD = "28ed6b2dba02379fbed9959c4bdab1e4978e4956";
const start = new Date("2026-11-02T17:17:55.000Z");
const minutes = (count: number) => new Date(start.getTime() + count * 60_000);

/**
 * Replay a failure that never changes against repeated wakes five minutes apart
 * (the historical 2 November timer; the lane is now event-driven), and count
 * the passes that actually ran.
 */
function attemptsOver(hours: number, wakeEveryMinutes: number): number {
  const path = join(mkdtempSync(join(tmpdir(), "streak-")), "streaks.json");
  const error = new Error(
    "Sandbox preflight failed: EACCES: permission denied, mkdir '/home/agent/.config/opencode'",
  );
  let attempts = 0;
  for (let minute = 0; minute <= hours * 60; minute += wakeEveryMinutes) {
    const now = minutes(minute);
    if (retryAfter(readStreaks(path).pass, now) !== null) continue;
    attempts += 1;
    recordFailure(path, "pass", failureFingerprint(HEAD, error), error.message, now);
  }
  return attempts;
}

test("a failure that repeats for 21 hours runs a bounded number of passes", () => {
  // Given: the broken sandbox image of 2 November, which failed the same
  // preflight 1,611 times in 21 hours.
  // When: wakes arrive every five minutes for 21 hours.
  const attempts = attemptsOver(21, 5);
  // Then: two free retries, the 10/20/40-minute steps, then one per hour.
  assert.ok(attempts <= 26, `${attempts} passes ran`);
  assert.ok(attempts >= 20, `${attempts} passes ran; the factory must keep probing`);
});

test("the first failures retry at once and the next one starts the backoff", () => {
  let streak = afterFailure(undefined, "f", "boom", minutes(0));
  assert.equal(retryAfter(streak, minutes(0)), null);
  streak = afterFailure(streak, "f", "boom", minutes(1));
  assert.equal(retryAfter(streak, minutes(1)), null);
  streak = afterFailure(streak, "f", "boom", minutes(2));
  assert.deepEqual(retryAfter(streak, minutes(2)), minutes(12));
  assert.equal(retryAfter(streak, minutes(12)), null);
  streak = afterFailure(streak, "f", "boom", minutes(12));
  assert.deepEqual(retryAfter(streak, minutes(13)), minutes(32));
});

test("the backoff never exceeds the cap", () => {
  let streak = afterFailure(undefined, "f", "boom", minutes(0));
  for (let index = 0; index < 60; index += 1) streak = afterFailure(streak, "f", "boom", minutes(0));
  assert.deepEqual(
    retryAfter(streak, minutes(0)),
    new Date(start.getTime() + DEFAULT_STREAK_POLICY.maxDelayMs),
  );
});

test("exactly one failure of a streak asks for an alert", () => {
  let streak = afterFailure(undefined, "f", "boom", minutes(0));
  const alerts: number[] = [];
  for (let count = 1; count <= 12; count += 1) {
    if (streakNeedsAlert(streak)) alerts.push(streak.count);
    streak = afterFailure(streak, "f", "boom", minutes(count));
  }
  assert.deepEqual(alerts, [3]);
});

test("a different failure starts a new streak", () => {
  let streak = afterFailure(undefined, "a", "first", minutes(0));
  streak = afterFailure(streak, "a", "first", minutes(1));
  streak = afterFailure(streak, "b", "second", minutes(2));
  assert.equal(streak.count, 1);
  assert.equal(streak.firstAt, minutes(2).toISOString());
});

test("a success ends the streak, so the next failure retries at once", () => {
  const path = join(mkdtempSync(join(tmpdir(), "streak-")), "streaks.json");
  for (let count = 0; count < 5; count += 1) recordFailure(path, "pass", "f", "boom", minutes(count));
  assert.notEqual(retryAfter(readStreaks(path).pass, minutes(5)), null);
  assert.equal(recordSuccess(path, "pass")?.count, 5);
  assert.equal(readStreaks(path).pass, undefined);
  assert.equal(recordSuccess(path, "pass"), undefined);
  recordFailure(path, "pass", "f", "boom", minutes(6));
  assert.equal(retryAfter(readStreaks(path).pass, minutes(6)), null);
});

test("streaks are kept per operation", () => {
  const path = join(mkdtempSync(join(tmpdir(), "streak-")), "streaks.json");
  for (let count = 0; count < 4; count += 1) recordFailure(path, "planner", "p", "no plan", minutes(count));
  recordFailure(path, "pass", "f", "boom", minutes(4));
  assert.equal(readStreaks(path).planner?.count, 4);
  assert.equal(readStreaks(path).pass?.count, 1);
  recordSuccess(path, "pass");
  assert.equal(readStreaks(path).planner?.count, 4);
});

test("run ids and commit ids do not make a repeat look new", () => {
  const first = failureFingerprint(HEAD, new Error("Command failed: git rev-parse sandcastle/preflight-1794512371725\nfatal: ambiguous"));
  const second = failureFingerprint(HEAD, new Error("Command failed: git rev-parse sandcastle/preflight-1794512603096\nfatal: ambiguous"));
  assert.equal(first, second);
  assert.notEqual(first, failureFingerprint(HEAD, new Error("exec failed: spawn E2BIG")));
});

test("a new factory commit is a new streak", () => {
  const error = new Error("Sandbox preflight failed");
  assert.notEqual(
    failureFingerprint(HEAD, error),
    failureFingerprint("da101bd9e4af68023dfd7d9c30370d394a4ac87b", error),
  );
});

test("a schema failure reads as a sentence, not a JSON dump", () => {
  // Given: the planner returned no plan, which used to surface as a raw
  // ZodError array in the alert log.
  const result = z.object({ issues: z.array(z.number()) }).safeParse(null);
  assert.equal(result.success, false);
  const message = failureMessage(result.error);
  assert.match(message, /^invalid data: \(root\): /);
  assert.doesNotMatch(message, /\n/);
});

test("an unreadable streak file is an empty record, and a bad timestamp does not block", () => {
  const path = join(mkdtempSync(join(tmpdir(), "streak-")), "streaks.json");
  writeFileSync(path, "{ not json");
  assert.deepEqual(readStreaks(path), {});
  assert.equal(
    retryAfter(
      { fingerprint: "f", message: "boom", count: 9, firstAt: "?", lastAt: "not a date" },
      minutes(0),
    ),
    null,
  );
});

test("deploying a fix retries at once instead of waiting out the old backoff", () => {
  // Given: a pass that has failed ten times at one factory commit.
  const fixed = "da101bd9e4af68023dfd7d9c30370d394a4ac87b";
  const error = new Error("Sandbox preflight failed");
  let streak = afterFailure(undefined, failureFingerprint(HEAD, error), error.message, minutes(0));
  for (let count = 1; count < 10; count += 1)
    streak = afterFailure(streak, failureFingerprint(HEAD, error), error.message, minutes(count));
  // Then: that commit is held back, and the fixed one is not.
  assert.notEqual(retryAfterIn(HEAD, streak, minutes(10)), null);
  assert.equal(retryAfterIn(fixed, streak, minutes(10)), null);
  // And: a failure of the fixed commit starts counting from one.
  assert.equal(afterFailure(streak, failureFingerprint(fixed, error), error.message, minutes(11)).count, 1);
});
