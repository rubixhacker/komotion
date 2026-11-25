import { test } from "node:test";
import assert from "node:assert/strict";
import { runTicketPool } from "./ticket-pool.mjs";

type Item = { number: number; mode: "author" | "resume" };

test("a delivered ticket frees its slot while another ticket is still running", async () => {
  const work: Item[] = [
    { number: 1, mode: "author" },
    { number: 2, mode: "author" },
    { number: 3, mode: "author" },
  ];
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const started: number[] = [];
  const running = runTicketPool(
    work,
    2,
    () => true,
    async (item) => {
      started.push(item.number);
      if (item.number === 1) await slow;
    },
    (_item, error) => {
      throw error;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), [1, 2, 3]);
  releaseSlow();
  await running;
});

test("resumes lead one worklist and the new-author deadline is checked per dequeue", async () => {
  const work: Item[] = [
    { number: 10, mode: "resume" },
    { number: 11, mode: "resume" },
    { number: 12, mode: "author" },
    { number: 13, mode: "author" },
  ];
  let calls = 0;
  const started: number[] = [];
  const errors: string[] = [];
  await runTicketPool(
    work,
    2,
    (item) => item.mode === "resume" || calls++ === 0,
    async (item) => {
      started.push(item.number);
      if (item.number === 12) throw new Error("stop this ticket only");
    },
    (item, error) => errors.push(`${item.number}:${(error as Error).message}`),
  );
  assert.deepEqual(started, [10, 11, 12]);
  assert.deepEqual(errors, ["12:stop this ticket only"]);
});

test("a dead budget prevents new work without discarding queued resumes", async () => {
  const started: number[] = [];
  await runTicketPool(
    [
      { number: 1, mode: "resume" },
      { number: 2, mode: "author" },
    ],
    1,
    (item) => item.mode === "resume",
    async (item) => {
      started.push(item.number);
    },
    () => assert.fail("unexpected error"),
  );
  assert.deepEqual(started, [1]);
});

test("an idle slot takes tickets that arrive while another ticket is running", async () => {
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let wake: () => void = () => {};
  const arrivals: Item[][] = [[], [{ number: 2, mode: "author" }, { number: 3, mode: "author" }]];
  const started: number[] = [];
  let asked = 0;
  const running = runTicketPool<Item>(
    [{ number: 1, mode: "author" }],
    2,
    () => true,
    async (item) => {
      started.push(item.number);
      if (item.number === 1) await slow;
    },
    (_item, error) => {
      throw error;
    },
    {
      more: async () => {
        asked += 1;
        return arrivals.shift() ?? [];
      },
      idle: async (stop) => {
        let woken = false;
        wake = () => {
          woken = true;
        };
        while (!woken && !stop()) await new Promise((resolve) => setImmediate(resolve));
        return true;
      },
      onError: (error) => {
        throw error;
      },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1]);
  wake();
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  // Ticket 1 is still running; the idle slot ran both arrivals.
  assert.deepEqual(started, [1, 2, 3]);
  releaseSlow();
  await running;
  assert.ok(asked >= 3);
});

test("the pool ends when nothing runs and a refill finds nothing", async () => {
  let asked = 0;
  let waited = 0;
  await runTicketPool<Item>(
    [{ number: 1, mode: "author" }],
    2,
    () => true,
    async () => {},
    (_item, error) => {
      throw error;
    },
    {
      more: async () => {
        asked += 1;
        return [];
      },
      idle: async (stop) => {
        waited += 1;
        while (!stop()) await new Promise((resolve) => setImmediate(resolve));
        return true;
      },
      onError: (error) => {
        throw error;
      },
    },
  );
  assert.ok(asked >= 1);
  assert.ok(waited <= 1);
});

test("a refill that throws is reported and does not end a running ticket", async () => {
  const errors: string[] = [];
  const started: number[] = [];
  await runTicketPool<Item>(
    [{ number: 1, mode: "author" }],
    2,
    () => true,
    async (item) => {
      started.push(item.number);
      await new Promise((resolve) => setImmediate(resolve));
    },
    (_item, error) => {
      throw error;
    },
    {
      more: async () => {
        throw new Error("planner down");
      },
      idle: async () => false,
      onError: (error) => errors.push((error as Error).message),
    },
  );
  assert.deepEqual(started, [1]);
  assert.ok(errors.includes("planner down"));
});

test("an idle slot stops asking once the pass takes no more new work", async () => {
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let asked = 0;
  const running = runTicketPool<Item>(
    [{ number: 1, mode: "author" }],
    2,
    () => true,
    async () => {
      await slow;
    },
    (_item, error) => {
      throw error;
    },
    {
      more: async () => {
        asked += 1;
        return [];
      },
      idle: async () => false,
      onError: (error) => {
        throw error;
      },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const askedWhileRunning = asked;
  releaseSlow();
  await running;
  assert.equal(askedWhileRunning, 1);
});
