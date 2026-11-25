import { test } from "node:test";
import assert from "node:assert/strict";
import { StallDetector } from "./stall.mjs";

test("the same call repeated to the limit reports a stall", () => {
  // Given: a detector that tolerates three repeats of one call.
  const detector = new StallDetector(3);
  const call = {
    type: "toolCall" as const,
    name: "bash",
    formattedArgs: 'grep -n "exclude" androidApp/build.gradle.kts',
  };
  // When: the agent issues that exact call three times.
  const reports = [detector.observe(call), detector.observe(call), detector.observe(call)];
  // Then: only the last one is a stall, and it counts three.
  assert.deepEqual(
    reports.map((report) => report.stalled),
    [false, false, true],
  );
  assert.equal(reports[2]?.repeats, 3);
});

test("a different call resets the count", () => {
  // Given: a detector that has seen one call twice.
  const detector = new StallDetector(3);
  const first = { type: "toolCall" as const, name: "read", formattedArgs: '"a.ts"' };
  const second = { type: "toolCall" as const, name: "read", formattedArgs: '"b.ts"' };
  detector.observe(first);
  detector.observe(first);
  // When: the agent moves to another file and then returns once.
  const afterMove = detector.observe(second);
  const back = detector.observe(first);
  // Then: progress resets the streak, so neither call is a stall.
  assert.equal(afterMove.repeats, 1);
  assert.equal(back.repeats, 1);
  assert.equal(back.stalled, false);
});

test("prose between identical calls does not hide the loop", () => {
  // Given: a detector watching an agent that talks between repeated calls.
  const detector = new StallDetector(2);
  const call = { type: "toolCall" as const, name: "bash", formattedArgs: "ls" };
  const prose = { type: "text" as const, message: "Let me check that again." };
  // When: the loop alternates with prose, as it does in a real stall.
  detector.observe(call);
  detector.observe(prose);
  const second = detector.observe(call);
  // Then: the streak still counts and trips.
  assert.equal(second.stalled, true);
  assert.equal(second.repeats, 2);
});

test("the signature names the repeated call for the log", () => {
  // Given: a detector and one call.
  const detector = new StallDetector(5);
  // When: the call is observed.
  const report = detector.observe({
    type: "toolCall",
    name: "bash",
    formattedArgs: "wc -l a.ts b.ts",
  });
  // Then: the report carries the exact signature an operator can search for.
  assert.equal(report.signature, "bash wc -l a.ts b.ts");
});

test("a limit below two is refused", () => {
  // Given: the factory wiring could pass a nonsensical limit.
  // When/Then: it fails at construction instead of silently never tripping.
  assert.throws(() => new StallDetector(1), RangeError);
});
