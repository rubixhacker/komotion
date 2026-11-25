import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

test("a leftover lock file does not prevent a new factory run", () => {
  // Given: a lock file remains after the previous process exited.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-lock-test-"));
  const lock = join(root, "factory.lock");
  const script = join(root, "probe.mts");
  const module = fileURLToPath(new URL("./lock.mts", import.meta.url));
  writeFileSync(lock, "");
  writeFileSync(
    script,
    `import { enterFactoryLock } from ${JSON.stringify(module)};\nenterFactoryLock(${JSON.stringify(lock)}, process.argv[1]);\nconsole.log("LOCK_ACQUIRED");\n`,
  );
  try {
    // When: a new factory process starts with the persisted file present.
    const result = spawnSync(process.execPath, [...process.execArgv, script], {
      encoding: "utf8",
    });
    // Then: it acquires the released kernel lock and starts normally.
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LOCK_ACQUIRED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createProbe(root: string) {
  const lock = join(root, "factory.lock");
  const script = join(root, "probe.mts");
  const module = fileURLToPath(new URL("./lock.mts", import.meta.url));
  writeFileSync(
    script,
    `import { enterFactoryLock } from ${JSON.stringify(module)};\nenterFactoryLock(${JSON.stringify(lock)}, process.argv[1]);\nconsole.log("OWNER=" + process.pid);\nif (process.argv.includes("--hold")) setInterval(() => {}, 1000);\n`,
  );
  return script;
}

async function startOwner(script: string) {
  const runner = spawn(
    process.execPath,
    [...process.execArgv, script, "--hold"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  runner.stdout.setEncoding("utf8");
  let output = "";
  for await (const chunk of runner.stdout) {
    output += String(chunk);
    const match = /OWNER=(\d+)/.exec(output);
    if (match?.[1]) return { runner, pid: Number(match[1]) };
  }
  throw new Error("Lock owner exited before becoming ready");
}

async function stopOwner(owner: Awaited<ReturnType<typeof startOwner>>) {
  const exited = once(owner.runner, "close");
  process.kill(owner.pid, "SIGKILL");
  await exited;
}

test(
  "a concurrent factory gets a clear rejection while another owns the lock",
  // Spawning a second real factory process and waiting for its lock rejection can take longer
  // than 10 s on a loaded CI runner; the assertion is about the rejection, not the wall clock.
  { timeout: 30000 },
  async () => {
    // Given: a real factory process owns the kernel lock.
    const root = mkdtempSync(join(tmpdir(), "sandcastle-lock-test-"));
    const script = createProbe(root);
    const owner = await startOwner(script);
    try {
      // When: a second factory starts.
      const result = spawnSync(
        process.execPath,
        [...process.execArgv, script],
        { encoding: "utf8" },
      );
      // Then: it does not run and reports the active owner.
      assert.equal(result.status, 75);
      assert.match(result.stderr, /already active/);
      assert.doesNotMatch(result.stdout, /OWNER=/);
    } finally {
      await stopOwner(owner);
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "a factory can restart after the lock owner is forcibly killed",
  // Spawning a second real factory process and waiting for its lock rejection can take longer
  // than 10 s on a loaded CI runner; the assertion is about the rejection, not the wall clock.
  { timeout: 30000 },
  async () => {
    // Given: a prior owner was killed without any cleanup callback.
    const root = mkdtempSync(join(tmpdir(), "sandcastle-lock-test-"));
    const script = createProbe(root);
    const owner = await startOwner(script);
    await stopOwner(owner);
    try {
      // When: a new factory starts using the same lock file.
      const result = spawnSync(
        process.execPath,
        [...process.execArgv, script],
        { encoding: "utf8" },
      );
      // Then: it acquires the lock automatically.
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /OWNER=/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
