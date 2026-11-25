import { test } from "node:test";
import assert from "node:assert/strict";
import { agentWasKilled, agentWentSilent, withRetries } from "./retry.mjs";

test("a read that fails for a moment is repeated until it answers", () => {
  const pauses: number[] = [];
  let calls = 0;
  const answer = withRetries(
    3,
    () => {
      calls += 1;
      if (calls < 3) throw new Error("HTTP 502: 502 Bad Gateway");
      return "body";
    },
    (failed) => pauses.push(failed),
  );
  assert.equal(answer, "body");
  assert.deepEqual(pauses, [1, 2]);
});

test("a read that keeps failing throws its last error after the final attempt", () => {
  let calls = 0;
  assert.throws(
    () =>
      withRetries(
        3,
        () => {
          calls += 1;
          throw new Error(`failure ${calls}`);
        },
        () => {},
      ),
    /failure 3/,
  );
  assert.equal(calls, 3);
});

test("a read that answers at once is not repeated and never pauses", () => {
  let calls = 0;
  assert.equal(
    withRetries(
      3,
      () => {
        calls += 1;
        return 7;
      },
      () => assert.fail("no pause is due"),
    ),
    7,
  );
  assert.equal(calls, 1);
});

test("an agent that was killed is told apart from one that failed", () => {
  assert.equal(agentWasKilled("opencode exited with code 137:\nLet me stop the process"), true);
  assert.equal(agentWasKilled("opencode exited with code 143:"), true);
  assert.equal(agentWasKilled("opencode exited with code 1: provider error"), false);
  assert.equal(agentWasKilled("opencode exited with code 1370"), false);
});

test("a run the library stopped for silence is recognised, and other failures are not", () => {
  assert.equal(
    agentWentSilent(
      "Agent idle for 1800 seconds — no output received. Increase the idleTimeoutSeconds option to allow longer silences.",
    ),
    true,
  );
  assert.equal(agentWentSilent("opencode exited with code 137:"), false);
  assert.equal(agentWentSilent("Agent idle for 3 minutes"), false);
});
