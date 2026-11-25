import assert from "node:assert/strict";
import test from "node:test";
import { mapLimit } from "./map-limit.mjs";

test("mapLimit keeps results in input order", async () => {
  const result = await mapLimit([5, 1, 3], 2, async (n) => n * 2);
  assert.deepEqual(result, [10, 2, 6]);
});

test("mapLimit never runs more than the limit at once", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return n;
  });
  assert.deepEqual(result, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});

test("mapLimit runs every item once, even with a limit above the item count", async () => {
  const seen: number[] = [];
  await mapLimit([1, 2], 8, async (n) => {
    seen.push(n);
  });
  assert.deepEqual(seen.sort(), [1, 2]);
});

test("mapLimit rejects invalid limits and propagates task errors", async () => {
  await assert.rejects(() => mapLimit([1], 0, async (n) => n));
  await assert.rejects(
    () =>
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    /boom/,
  );
});
