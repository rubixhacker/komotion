// launchd keeps the lane logs open, so capping must preserve the inode and
// retain only complete lines. Archives are pruned independently.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capLaneLogs, capLogInPlace, pruneLogArchives } from "./logs.mts";
import { command } from "./process.mts";

const testDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "komotion-logs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("capping retains the newest complete lines in place", (t) => {
  const dir = workspace(t);
  const file = join(dir, "launchd-factory.log");
  const lines = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, "0")} ${"z".repeat(50)}\n`);
  writeFileSync(file, `${lines.join("")}PARTIAL`);
  const inode = statSync(file).ino;

  assert.equal(capLogInPlace(file, 200), true);
  const capped = readFileSync(file, "utf8");
  assert.equal(statSync(file).ino, inode);
  assert.ok(statSync(file).size <= 200);
  assert.ok(capped.endsWith("\n"));
  assert.match(capped, /19 z{50}\n$/);
  assert.equal(capped.includes("PARTIAL"), false);
  assert.equal(capped.includes("00 "), false);
});

test("a log under the cap is untouched", (t) => {
  const dir = workspace(t);
  const file = join(dir, "launchd-factory.log");
  writeFileSync(file, "one\ntwo\n");
  const inode = statSync(file).ino;
  assert.equal(capLogInPlace(file, 1000), false);
  assert.equal(readFileSync(file, "utf8"), "one\ntwo\n");
  assert.equal(statSync(file).ino, inode);
});

test("archive pruning keeps only the newest archives per stream", (t) => {
  const dir = workspace(t);
  const logs = join(dir, ".sandcastle/logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "launchd-factory.log"), "active\n");
  const archives: string[] = [];
  for (let i = 0; i < 7; i++) {
    const file = join(logs, `launchd-factory.log.${i}`);
    writeFileSync(file, `${i}\n`);
    const stamp = new Date(Date.now() - (7 - i) * 60_000);
    utimesSync(file, stamp, stamp);
    archives.push(file);
  }
  assert.equal(pruneLogArchives(dir, "factory", 2), 5);
  assert.equal(statSync(archives[5]!).ino > 0, true);
  assert.equal(archives.slice(0, 5).every((file) => !exists(file)), true);
});

function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

test("the CLI caps both lane logs at startup or exit", async (t) => {
  const dir = workspace(t);
  mkdirSync(join(dir, ".sandcastle/logs"), { recursive: true });
  const out = join(dir, ".sandcastle/logs/launchd-factory.log");
  const err = join(dir, ".sandcastle/logs/launchd-factory.err.log");
  const big = `${"x".repeat(100)}\n`.repeat(20);
  writeFileSync(out, big);
  writeFileSync(err, big);
  const inodes = [statSync(out).ino, statSync(err).ino];

  await command(process.execPath, [
    "--experimental-strip-types",
    join(testDir, "logs.mts"),
    "cap", "--root", dir, "--lane", "factory",
  ], { env: { ...process.env, SANDCASTLE_LOG_MAX_BYTES: "80" } });

  assert.deepEqual([statSync(out).ino, statSync(err).ino], inodes);
  assert.ok(statSync(out).size <= 80);
  assert.ok(statSync(err).size <= 80);
});

test("capLaneLogs handles missing files", (t) => {
  const dir = workspace(t);
  capLaneLogs(dir, "triage");
});
