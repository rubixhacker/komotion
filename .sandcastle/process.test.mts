// Tests for the bounded host process layer used by every lane entry point.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  command,
  commandJson,
  CommandError,
  runCommand,
} from "./process.mts";

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "komotion-process-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("command returns stdout and commandJson parses it", async () => {
  const output = await command(process.execPath, ["-e", "process.stdout.write('hello')"]);
  assert.equal(output, "hello");
  const json = await commandJson<{ ok: boolean }>(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify({ok: true}))",
  ]);
  assert.deepEqual(json, { ok: true });
});

test("runCommand retains only bounded stdout and stderr tails", async () => {
  const result = await runCommand(process.execPath, ["-e", [
    "process.stdout.write('x'.repeat(100_000));",
    "process.stderr.write('y'.repeat(100_000));",
  ].join("")], { maxTailBytes: 32 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "x".repeat(32));
  assert.equal(result.stderr, "y".repeat(32));
});

test("command throws a structured error with a bounded output tail", async () => {
  await assert.rejects(
    command(process.execPath, ["-e", "console.error('boom'); process.exit(9)"], { maxTailBytes: 16 }),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.kind, "exit");
      assert.equal(error.exitCode, 9);
      assert.match(error.stderr, /boom/);
      assert.equal(error.command[0], process.execPath);
      return true;
    },
  );
});

test("commandJson reports invalid JSON as a structured error", async () => {
  await assert.rejects(
    commandJson(process.execPath, ["-e", "process.stdout.write('not json')"]),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.kind, "invalid-json");
      return true;
    },
  );
});

test("a timeout TERMs then KILLs the whole process group", async (t) => {
  const dir = workspace(t);
  const pidFile = join(dir, "grandchild.pid");
  const source = [
    "const fs = require('node:fs');",
    "const cp = require('node:child_process');",
    `const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

  await assert.rejects(
    runCommand(process.execPath, ["-e", source], { timeoutMs: 1000, killGraceMs: 100 }),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.kind, "timeout");
      return true;
    },
  );

  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(pid > 0);
  let alive = true;
  for (let attempt = 0; attempt < 10 && alive; attempt += 1) {
    try {
      process.kill(pid, 0);
      await new Promise((done) => setTimeout(done, 50));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, "the grandchild in the timed-out process group survived");
});

test("an AbortSignal stops the process group", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("cancelled")), 300);
  try {
    await assert.rejects(
      runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        signal: controller.signal,
        killGraceMs: 50,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.kind, "aborted");
        return true;
      },
    );
  } finally {
    clearTimeout(timer);
  }
});

test("a pre-aborted signal never starts the command", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCommand(process.execPath, ["-e", "process.stdout.write('ran')"], { signal: controller.signal }),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.kind, "aborted");
      assert.equal(error.stdout, "");
      return true;
    },
  );
});

test("a spawn failure is a structured CommandError", async () => {
  await assert.rejects(
    runCommand("/definitely/not/a/program", []),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.kind, "spawn");
      return true;
    },
  );
});
