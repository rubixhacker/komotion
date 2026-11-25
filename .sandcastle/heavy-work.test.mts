// The heavy-work adapter is optional on other hosts, deferral-aware on the
// Mac, and injectable so the gate command can be asserted without a lock.

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEAVY_WORK_GATE_ENV,
  HEAVY_WORK_HELD_ENV,
  runHeavyWork,
  type HeavyWorkRunner,
} from "./heavy-work.mts";

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "komotion-heavy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const calls: {
    program: string;
    args: string[];
    env: NodeJS.ProcessEnv | undefined;
    timeoutMs: number | undefined;
  }[] = [];
  const runner: HeavyWorkRunner = async (program, args, options) => {
    calls.push({ program, args: [...args], env: options.env, timeoutMs: options.timeoutMs });
    return { command: [program, ...args], code: 0, signal: null, stdout: "", stderr: "", durationMs: 0 };
  };
  return { calls, runner };
}

test("without a gate the adapter runs the program directly", async () => {
  const { calls, runner } = recorder();
  await runHeavyWork({
    label: "delivery-gate",
    program: "./gradlew",
    args: ["desktopTest"],
    env: {},
    waitSeconds: 10,
    timeoutSeconds: 60,
    run: runner,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.program, "./gradlew");
  assert.deepEqual(calls[0]!.args, ["desktopTest"]);
  assert.equal(calls[0]!.timeoutMs, 65_000);
});

test("a configured executable gate receives the documented contract", async (t) => {
  const dir = workspace(t);
  const gate = join(dir, "gate");
  writeFileSync(gate, "#!/bin/sh\nexit 0\n");
  chmodSync(gate, 0o755);

  const { calls, runner } = recorder();
  await runHeavyWork({
    label: "git-rebase-sandcastle-issue-1",
    program: "git",
    args: ["rebase", "origin/main"],
    cwd: dir,
    env: { [HEAVY_WORK_GATE_ENV]: gate },
    waitSeconds: 12,
    timeoutSeconds: 34,
    run: runner,
  });
  assert.equal(calls[0]!.program, gate);
  assert.deepEqual(calls[0]!.args, [
    "--label", "git-rebase-sandcastle-issue-1",
    "--wait", "12",
    "--timeout", "34",
    "--", "git", "rebase", "origin/main",
  ]);
  assert.equal(calls[0]!.timeoutMs, (12 + 34 + 10) * 1000);
});

test("holding the lock bypasses the gate and marks descendants as held", async (t) => {
  const dir = workspace(t);
  const gate = join(dir, "gate");
  writeFileSync(gate, "#!/bin/sh\nexit 0\n");
  chmodSync(gate, 0o755);

  const { calls, runner } = recorder();
  await runHeavyWork({
    label: "agent-gradle",
    program: ".sandcastle/agent/bin/gradle",
    args: ["desktopTest"],
    env: { [HEAVY_WORK_HELD_ENV]: "1", [HEAVY_WORK_GATE_ENV]: gate },
    run: runner,
  });
  assert.equal(calls[0]!.program, ".sandcastle/agent/bin/gradle");
  assert.equal(calls[0]!.env?.[HEAVY_WORK_HELD_ENV], "1");
});

test("a gate exit of 75 is returned as a deferral", async () => {
  const result = await runHeavyWork({
    label: "delivery-gate",
    program: "true",
    env: {},
    run: async () => ({
      command: ["gate"],
      code: 75,
      signal: null,
      stdout: "lock busy",
      stderr: "",
      durationMs: 1,
    }),
  });
  assert.equal(result.code, 75);
});

test("a real gate script is invoked with its argv and can defer", async (t) => {
  const dir = workspace(t);
  const argvFile = join(dir, "argv.txt");
  const gate = join(dir, "gate");
  writeFileSync(gate, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\nexit 75\n`);
  chmodSync(gate, 0o755);

  const result = await runHeavyWork({
    label: "delivery-gate",
    program: "/bin/echo",
    args: ["hello"],
    env: { [HEAVY_WORK_GATE_ENV]: gate, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    waitSeconds: 7,
    timeoutSeconds: 90,
  });
  assert.equal(result.code, 75);
  assert.deepEqual(readFileSync(argvFile, "utf8").trim().split("\n"), [
    "--label", "delivery-gate",
    "--wait", "7",
    "--timeout", "90",
    "--", "/bin/echo", "hello",
  ]);
});

test("heavy work requires a label", async () => {
  await assert.rejects(
    runHeavyWork({ label: " ", program: "true", env: {}, run: recorder().runner }),
    /needs a label/,
  );
});

