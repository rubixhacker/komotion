import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterPass, startDelayMs } from "./drain-policy.mjs";
import { type FactoryStatus, readStatus } from "./status.mjs";

/**
 * Drain the ready-for-agent queue by running factory passes back to back.
 *
 * Each pass keeps its own lock and its own issue cap, so this driver only
 * decides when another pass is worthwhile (`afterPass`). The pass writes
 * straight to the journal; the driver reads the pass's status file.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainScript = resolve(root, ".sandcastle/main.mts");
const retroScript = resolve(root, ".sandcastle/retro.mts");
const tsx = resolve(root, ".sandcastle/node_modules/tsx/dist/cli.mjs");
const statusPath = resolve(root, ".sandcastle/logs/status.json");
const maxPasses = Number(process.env.SANDCASTLE_DRAIN_PASSES ?? 20);

function branchState(): string {
  const result = spawnSync(
    "git",
    ["ls-remote", "--heads", "origin", "sandcastle/issue-*"],
    { cwd: root, encoding: "utf8" },
  );
  return (result.stdout ?? "").trim();
}

function passStatus(): FactoryStatus | null {
  try {
    return readStatus(statusPath);
  } catch {
    return null;
  }
}

const delay = startDelayMs(passStatus(), new Date());
if (delay > 0) {
  console.log(
    `factory drain: the last pass ended moments ago; waiting ${Math.round(delay / 1000)} s before the first pass.`,
  );
  await new Promise((done) => setTimeout(done, delay));
}

/**
 * Brings the checkout to the merged code before a pass loads it. The unit runs
 * the same script before the driver starts, so the first pass needs nothing;
 * a later pass would otherwise run whatever was merged when the unit started,
 * which can be a day old. A failure keeps the code the unit already verified.
 */
function loadMergedCode(): void {
  const result = spawnSync("bash", [resolve(root, "scripts/ci/sandcastle-runtime.sh")], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0)
    console.log("factory drain: the runtime could not be brought up to date; running the code it has.");
}

for (let pass = 1; pass <= maxPasses; pass += 1) {
  if (pass > 1) loadMergedCode();
  const branchesBefore = branchState();
  console.log(`\n=== factory drain: pass ${pass}/${maxPasses} ===`);
  const startedAt = new Date();
  const result = spawnSync(process.execPath, [tsx, mainScript], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  // The retro is a post-pass task: a separate process started only after the
  // pass has exited. A failure here must not stop the drain or hide the pass's
  // own outcome.
  const retro = spawnSync(process.execPath, [tsx, retroScript], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (retro.status !== 0)
    console.log("factory drain: the post-pass retro failed; continuing.");
  const step = afterPass({
    exitCode: result.status,
    signal: result.signal,
    status: passStatus(),
    startedAt,
    branchesBefore,
    branchesAfter: branchState(),
  });
  if (step.next === "continue") continue;
  console.log(`factory drain: ${step.reason}; stopping.`);
  if (step.exitCode !== 0) process.exit(step.exitCode);
  break;
}

console.log("factory drain: finished.");
