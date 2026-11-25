import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DELIVERY_STALL_MINUTES,
  deliveryFailedCount,
  deliveryStallState,
  parseDeliveryWindowMinutes,
  readDeliveryFacts,
  recordDelivery,
} from "./delivery-stall.mjs";

/**
 * A throwaway factory logs directory: the delivery facts file the factory
 * writes when it opens a delivery pull request, and the ledger of the heads
 * escalated to a human after the factory's repair rounds are spent.
 */
function logs() {
  const dir = mkdtempSync(join(tmpdir(), "delivery-stall-"));
  const factsPath = join(dir, "delivery-stall.json");
  return {
    dir,
    factsPath,
    /** Simulate the factory opening a delivery pull request at `at`. */
    deliver: (at: Date) => recordDelivery(factsPath, at),
    /** Simulate a delivery head being escalated to a human. */
    escalate: (heads: readonly string[]) =>
      writeFileSync(join(dir, "ci-alerts.json"), `${JSON.stringify(heads, null, 2)}\n`),
    /** The stall decision the Grafana alert fires on, from the simulated ledgers. */
    state: (now: Date, windowMinutes?: number) =>
      deliveryStallState(
        now,
        readDeliveryFacts(factsPath).lastDeliveryAt,
        deliveryFailedCount(dir),
        windowMinutes ?? DEFAULT_DELIVERY_STALL_MINUTES,
      ),
  };
}

const at = (iso: string) => new Date(iso);

test("a failed delivery stalls at once, even with a recent delivery", () => {
  // Given: the factory opened a delivery pull request an hour ago.
  const host = logs();
  host.deliver(at("2026-11-18T12:00:00Z"));
  // When: one of its heads is escalated to a human after the repair rounds.
  host.escalate(["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  // Then: the stall decision is on, and it names the failed delivery.
  const state = host.state(at("2026-11-18T13:00:00Z"));
  assert.equal(state.stalled, true);
  assert.equal(state.deliveryFailed, true);
  assert.equal(state.noNewDelivery, false);
});

test("no new delivery for the configured window stalls", () => {
  // Given: the last delivery was two days ago and nothing has failed.
  const host = logs();
  host.deliver(at("2026-11-16T12:00:00Z"));
  // When: the window is the default 24 hours.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  // Then: the stall decision is on, and it names the no-delivery window.
  assert.equal(state.stalled, true);
  assert.equal(state.deliveryFailed, false);
  assert.equal(state.noNewDelivery, true);
  assert.equal(state.lastDeliveryAgeSeconds, 2 * 24 * 3600);
});

test("a shorter configured window stalls earlier", () => {
  // Given: the last delivery was ten hours ago and nothing has failed.
  const host = logs();
  host.deliver(at("2026-11-18T02:00:00Z"));
  // When: the window is configured to six hours.
  const state = host.state(at("2026-11-18T12:00:00Z"), 6 * 60);
  // Then: the stall decision is on.
  assert.equal(state.stalled, true);
  assert.equal(state.noNewDelivery, true);
});

test("a healthy factory stays quiet", () => {
  // Given: the factory delivered four hours ago and nothing has failed.
  const host = logs();
  host.deliver(at("2026-11-18T08:00:00Z"));
  // When: the window is the default 24 hours.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  // Then: the stall decision is off.
  assert.equal(state.stalled, false);
  assert.equal(state.deliveryFailed, false);
  assert.equal(state.noNewDelivery, false);
});

test("a delivery at the edge of the window does not stall", () => {
  // Given: the last delivery was exactly 24 hours ago.
  const host = logs();
  host.deliver(at("2026-11-17T12:00:00Z"));
  // When: the window is the default 24 hours.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  // Then: the window has not passed yet.
  assert.equal(state.stalled, false);
  assert.equal(state.noNewDelivery, false);
});

test("a factory that never delivered has no window to measure", () => {
  // Given: no delivery has been recorded and nothing has failed.
  const host = logs();
  // When: the window is the default 24 hours.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  // Then: the stall decision is off, and no age is reported.
  assert.equal(state.stalled, false);
  assert.equal(state.lastDeliveryAgeSeconds, null);
});

test("a failed delivery stalls a factory that never delivered", () => {
  // Given: no delivery has been recorded.
  const host = logs();
  // When: a delivery head is escalated to a human.
  host.escalate(["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  // Then: the stall decision is on, naming the failed delivery.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  assert.equal(state.stalled, true);
  assert.equal(state.deliveryFailed, true);
});

test("a clock skew that puts the last delivery in the future does not stall", () => {
  // Given: the recorded delivery is in the future.
  const host = logs();
  host.deliver(at("2026-11-18T13:00:00Z"));
  // When: the decision is made an hour earlier.
  const state = host.state(at("2026-11-18T12:00:00Z"));
  // Then: the age is clamped to zero and the window has not passed.
  assert.equal(state.stalled, false);
  assert.equal(state.lastDeliveryAgeSeconds, 0);
});

test("a merged delivery clears its failure and the factory quiets", () => {
  // Given: a delivery head was escalated to a human.
  const host = logs();
  host.escalate(["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  // When: the pull request merges and the factory clears the head from the ledger.
  writeFileSync(join(host.dir, "ci-alerts.json"), "[]\n");
  // Then: with a recent delivery, the stall decision is off.
  host.deliver(at("2026-11-18T11:00:00Z"));
  const state = host.state(at("2026-11-18T12:00:00Z"));
  assert.equal(state.stalled, false);
  assert.equal(state.deliveryFailed, false);
});

test("the facts file round-trips, and a missing or corrupt file has no known delivery", () => {
  const dir = mkdtempSync(join(tmpdir(), "delivery-stall-"));
  const path = join(dir, "delivery-stall.json");
  // Given: no facts file.
  assert.deepEqual(readDeliveryFacts(path), { lastDeliveryAt: null });
  // When: the factory records a delivery.
  recordDelivery(path, at("2026-11-18T12:00:00Z"));
  // Then: the record reads back.
  assert.deepEqual(readDeliveryFacts(path), { lastDeliveryAt: "2026-11-18T12:00:00.000Z" });
  // When: the file is corrupt.
  writeFileSync(path, "not a facts file\n");
  // Then: it reads as no known delivery.
  assert.deepEqual(readDeliveryFacts(path), { lastDeliveryAt: null });
});

test("the failure count is the number of escalated heads, and zero without a ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "delivery-stall-"));
  // Given: no ledger.
  assert.equal(deliveryFailedCount(dir), 0);
  // When: heads are escalated.
  writeFileSync(join(dir, "ci-alerts.json"), JSON.stringify(["head-one", "head-two:conflict"]));
  // Then: each escalated head counts as a failed delivery.
  assert.equal(deliveryFailedCount(dir), 2);
});

test("the window parser accepts whole minutes and falls back on any malformed value", () => {
  // Given: the default window is 1440 minutes.
  assert.equal(parseDeliveryWindowMinutes(undefined), DEFAULT_DELIVERY_STALL_MINUTES);
  // When: a whole number of minutes is configured.
  assert.equal(parseDeliveryWindowMinutes("60"), 60);
  assert.equal(parseDeliveryWindowMinutes("0"), 0);
  // Then: surrounding whitespace does not change the value.
  assert.equal(parseDeliveryWindowMinutes("  720  "), 720);
  // When: the value is empty, fractional, negative, or otherwise not a whole number of minutes.
  assert.equal(parseDeliveryWindowMinutes(""), DEFAULT_DELIVERY_STALL_MINUTES);
  assert.equal(parseDeliveryWindowMinutes("1.5"), DEFAULT_DELIVERY_STALL_MINUTES);
  assert.equal(parseDeliveryWindowMinutes("-60"), DEFAULT_DELIVERY_STALL_MINUTES);
  assert.equal(parseDeliveryWindowMinutes("60 minutes"), DEFAULT_DELIVERY_STALL_MINUTES);
  assert.equal(parseDeliveryWindowMinutes("0x10"), DEFAULT_DELIVERY_STALL_MINUTES);
});
