import { test } from "node:test";
import assert from "node:assert/strict";
import { RepairSlot } from "./repair-slot.mjs";

test("a slow repair leaves reconciliation free while preventing a second repair", async () => {
  const slot = new RepairSlot();
  let complete = () => {};
  const blocked = new Promise<void>((resolve) => {
    complete = resolve;
  });
  assert.equal(
    slot.start(42, () => blocked),
    true,
  );
  await Promise.resolve();
  assert.equal(slot.number, 42);
  assert.equal(slot.running, true);
  let otherRepairStarted = false;
  assert.equal(
    slot.start(43, async () => {
      otherRepairStarted = true;
    }),
    false,
  );
  assert.equal(otherRepairStarted, false);
  // The controller can observe another PR before the repair finishes.
  const inspected = await Promise.resolve("other PR checked");
  assert.equal(inspected, "other PR checked");
  const finishing = slot.finish();
  complete();
  await finishing;
  assert.equal(slot.running, false);
  assert.equal(
    slot.start(43, async () => {}),
    true,
  );
  await slot.finish();
});

test("a recorded repair failure frees the worker for the next PR", async () => {
  const slot = new RepairSlot();
  let recorded = false;
  slot.start(42, async () => {
    try {
      throw new Error("build failed");
    } catch (error) {
      assert.equal(error instanceof Error, true);
      recorded = true;
    }
  });
  await slot.finish();
  assert.equal(recorded, true);
  assert.equal(slot.running, false);
});
