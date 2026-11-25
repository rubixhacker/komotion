import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecResult } from "@ai-hero/sandcastle";
import { GATE_COMMAND, boundedGateExec } from "./gate-timeout.mjs";

const ok: ExecResult = { exitCode: 0, stdout: "BUILD SUCCESSFUL", stderr: "" };
const noSleep = async () => {};

test("a gate that finishes in time passes through untouched", async () => {
  let killed = 0;
  let asked = "";
  const bounded = await boundedGateExec(
    async (command) => {
      asked = command;
      return ok;
    },
    () => {
      killed += 1;
    },
    60_000,
  );
  assert.equal(asked, GATE_COMMAND);
  assert.deepEqual(bounded, { result: ok, timedOut: false });
  assert.equal(killed, 0);
});

test("an overrun gate is killed and reported as timed out", async () => {
  let killed = 0;
  let release: (result: ExecResult) => void = () => {};
  const exec = new Promise<ExecResult>((resolve) => {
    release = resolve;
  });
  const bounded = boundedGateExec(
    () => exec,
    () => {
      killed += 1;
      // The kill ends the gate's processes; the exec settles as they die.
      release({ exitCode: 137, stdout: "", stderr: "Killed" });
    },
    20,
    noSleep,
  );
  const result = await bounded;
  assert.equal(killed, 1);
  assert.equal(result.timedOut, true);
  assert.equal(result.result.exitCode, 137);
});

test("an exec that stays wedged after the kill still gets a failed result", async () => {
  let killed = 0;
  const bounded = await boundedGateExec(
    () => new Promise<ExecResult>(() => {}),
    () => {
      killed += 1;
    },
    20,
    noSleep,
  );
  assert.equal(killed, 1);
  assert.equal(bounded.timedOut, true);
  assert.notEqual(bounded.result.exitCode, 0);
  assert.match(bounded.result.stderr, /did not finish/u);
});

test("an exec that rejects is a failed gate, not a timeout", async () => {
  const bounded = await boundedGateExec(
    () => Promise.reject(new Error("the executor went away")),
    () => assert.fail("nothing to kill"),
    60_000,
  );
  assert.equal(bounded.timedOut, false);
  assert.equal(bounded.result.exitCode, 1);
  assert.match(bounded.result.stderr, /the executor went away/u);
});
