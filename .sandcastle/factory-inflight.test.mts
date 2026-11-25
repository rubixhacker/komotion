import { test } from "node:test";
import assert from "node:assert/strict";
import { INFLIGHT_LABEL } from "./queue.mjs";
import {
  flightMarks,
  staleInFlight,
  type InFlightCommand,
} from "./factory-inflight.mjs";

/** A GitHub stand-in that applies label edits so the lifecycle can be observed. */
function host(
  initial: readonly { number: number; state?: string; labels?: readonly string[] }[] = [],
) {
  const labels = new Map<number, Set<string>>(
    initial.map((issue) => [issue.number, new Set(issue.labels ?? [])]),
  );
  const calls: string[] = [];
  const run: InFlightCommand = (program, args) => {
    assert.equal(program, "gh");
    calls.push(args.join(" "));
    if (args[0] === "label") return "";
    assert.equal(args[0], "issue");
    const number = Number(args[2]);
    const held = labels.get(number) ?? new Set<string>();
    labels.set(number, held);
    const addAt = args.indexOf("--add-label");
    if (addAt >= 0) held.add(args[addAt + 1] ?? "");
    const removeAt = args.indexOf("--remove-label");
    if (removeAt >= 0) held.delete(args[removeAt + 1] ?? "");
    return "";
  };
  return {
    run,
    calls,
    has: (number: number) => labels.get(number)?.has(INFLIGHT_LABEL) === true,
  };
}

test("a claim adds the label and records the active worker", () => {
  const world = host();
  const flight = flightMarks(world.run);
  flight.claim(7);
  assert.equal(world.has(7), true);
  assert.deepEqual([...flight.active], [7]);
  assert.ok(
    world.calls.some((call) => call.startsWith("label create factory-inflight")),
    "the repository-specific label is created on demand",
  );
  assert.ok(
    world.calls.some(
      (call) => call.includes("issue edit 7") && call.includes(`--add-label ${INFLIGHT_LABEL}`),
    ),
  );
});

test("a delivered ticket loses the label", () => {
  const world = host();
  const flight = flightMarks(world.run);
  flight.claim(7);
  assert.equal(world.has(7), true);
  // Delivery clears the ledger and the worker releases its claim on the way out.
  flight.release(7);
  assert.equal(world.has(7), false);
  assert.equal(flight.active.size, 0);
  assert.ok(
    world.calls.some(
      (call) => call.includes("issue edit 7") && call.includes(`--remove-label ${INFLIGHT_LABEL}`),
    ),
  );
});

test("a deliberate stop releases every claim the factory still owns", () => {
  const world = host();
  const flight = flightMarks(world.run);
  flight.claim(7);
  flight.claim(12);
  flight.releaseAll();
  assert.equal(world.has(7), false);
  assert.equal(world.has(12), false);
  assert.equal(flight.active.size, 0);
});

test("a stale sweep clears a claim with neither worker nor branch behind it", () => {
  const world = host([
    { number: 7, state: "OPEN", labels: [INFLIGHT_LABEL] },
    { number: 12, state: "OPEN", labels: [INFLIGHT_LABEL] },
  ]);
  const labelled = [
    { number: 7, state: "OPEN" },
    { number: 12, state: "OPEN" },
  ];
  // A new process sees no workers from the crashed one.
  const flight = flightMarks(world.run);
  assert.deepEqual(flight.stale(labelled, "main\n"), [7, 12]);
  for (const issue of flight.stale(labelled, "main\n")) flight.release(issue);
  assert.equal(world.has(7), false);
  assert.equal(world.has(12), false);
});

test("a live worker or a retained branch keeps its claim through a sweep", () => {
  const active = flightMarks(() => "");
  active.claim(7);
  active.claim(12);
  const labelled = [
    { number: 7, state: "OPEN" },
    { number: 8, state: "OPEN" },
    { number: 12, state: "OPEN" },
    { number: 11, state: "CLOSED" },
  ];
  const branches = "sandcastle/issue-8\norigin/sandcastle/issue-12\nmain\n";
  // 7 has a worker, 8 has a local branch, 12 has both; 11 is closed.
  assert.deepEqual(active.stale(labelled, branches), [11]);
  // A branch number is matched whole, so issue 1 does not own issue 12's branch.
  assert.deepEqual(
    staleInFlight([{ number: 1, state: "OPEN" }], new Set(), branches),
    [1],
  );
});
