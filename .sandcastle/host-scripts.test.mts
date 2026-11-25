// End-to-end checks for the post-rebase shell wrappers: exact event
// snapshots, bounded alerts, exit-status preservation and the Gradle wrapper.

import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./process.mts";

const sandcastleDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ciScripts = resolve(sandcastleDir, "../scripts/ci");
const repoScripts = resolve(sandcastleDir, "../scripts");
const nodeDir = dirname(process.execPath);

function makeRoot(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(join(tmpdir(), "komotion-host-scripts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".sandcastle/logs"), { recursive: true });
  copyFileSync(join(sandcastleDir, "events.mts"), join(root, ".sandcastle/events.mts"));
  copyFileSync(join(sandcastleDir, "events-cli.mts"), join(root, ".sandcastle/events-cli.mts"));
  copyFileSync(join(sandcastleDir, "logs.mts"), join(root, ".sandcastle/logs.mts"));
  return root;
}

function writeScript(file: string, contents: string): void {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

function eventsDir(root: string, lane: string): string {
  return join(root, ".sandcastle/logs", `${lane}-events`);
}

interface LaneHarness {
  readonly root: string;
  readonly env: Record<string, string>;
  readonly laneScript: string;
  readonly alertScript: string;
  readonly alertCalls: string;
  readonly runtimeCalls: string;
  readonly laneCalls: string;
}

function laneHarness(t: { after: (fn: () => void) => void }): LaneHarness {
  const root = makeRoot(t);
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  mkdirSync(join(root, ".sandcastle/node_modules/tsx/dist"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  const laneScript = join(root, "scripts/ci/sandcastle-lane.sh");
  const alertScript = join(root, "scripts/sandcastle-alert.sh");
  copyFileSync(join(ciScripts, "sandcastle-lane.sh"), laneScript);
  copyFileSync(join(repoScripts, "sandcastle-alert.sh"), alertScript);
  chmodSync(laneScript, 0o755);
  chmodSync(alertScript, 0o755);

  writeFileSync(join(root, ".sandcastle/lanes-manifest.json"), "");
  mkdirSync(join(root, ".sandcastle/lanes"), { recursive: true });
  writeFileSync(join(root, ".sandcastle/lanes/manifest.json"), JSON.stringify({
    lanes: ["factory", "dependabot", "triage"].map((name) => ({
      name,
      entry: name === "factory" ? "drain" : name,
      interval: 300,
      runAtLoad: true,
      watchPath: `.sandcastle/logs/${name}-events`,
      doc: `lanes/${name}.md`,
    })),
  }));

  const alertCalls = join(root, "alert-calls.txt");
  const runtimeCalls = join(root, "runtime-calls.txt");
  const laneCalls = join(root, "lane-calls.txt");
  writeScript(join(root, "bin/osascript"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$ALERT_CALLS\"\nexit 0\n");
  writeScript(join(root, "scripts/ci/sandcastle-runtime.sh"), [
    "#!/bin/bash",
    'if [[ -n "${RUNTIME_CALLS:-}" ]]; then printf "ran\\n" >> "$RUNTIME_CALLS"; fi',
    'exit "${RUNTIME_STATUS:-0}"',
    "",
  ].join("\n"));
  writeScript(join(root, ".sandcastle/node_modules/tsx/dist/cli.mjs"), [
    "import { appendFileSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    "if (process.env.ARRIVE_DURING_PASS === '1') {",
    "  const result = spawnSync(process.execPath, ['--experimental-strip-types', process.env.EVENTS_TOOL,",
    "    'publish', '--directory', process.env.EVENTS_DIRECTORY, '--source', 'during-pass'], { stdio: 'ignore' });",
    "  if (result.status !== 0) process.exit(90);",
    "}",
    "if (process.env.LANE_CALLS) appendFileSync(process.env.LANE_CALLS, 'ran\\n');",
    "process.exit(Number(process.env.LANE_STATUS || 0));",
    "",
  ].join("\n"));

  const env: Record<string, string> = {
    ...process.env,
    PATH: `${join(root, "bin")}:${nodeDir}:${process.env.PATH ?? ""}`,
    SANDCASTLE_RUNTIME_DIR: root,
    EVENTS_TOOL: join(root, ".sandcastle/events-cli.mts"),
    EVENTS_DIRECTORY: eventsDir(root, "factory"),
    ALERT_CALLS: alertCalls,
    RUNTIME_CALLS: runtimeCalls,
    LANE_CALLS: laneCalls,
    RUNTIME_STATUS: "0",
    LANE_STATUS: "0",
  };
  return { root, env, laneScript, alertScript, alertCalls, runtimeCalls, laneCalls };
}

function envWith(harness: LaneHarness, values: Record<string, string>): Record<string, string> {
  return { ...harness.env, ...values };
}

async function runBash(file: string, args: readonly string[], env: Record<string, string>, cwd: string) {
  return runCommand("bash", [file, ...args], { env, cwd, timeoutMs: 30_000 });
}

async function publishMarker(root: string, env: Record<string, string>, lane = "factory", source = "test") {
  return runCommand(process.execPath, [
    "--experimental-strip-types",
    join(root, ".sandcastle/events-cli.mts"),
    "publish", "--directory", eventsDir(root, lane), "--source", source,
  ], { env, timeoutMs: 30_000 });
}

test("publication writes one complete marker with no temporary files", async (t) => {
  const root = makeRoot(t);
  const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH ?? ""}` };
  const first = await publishMarker(root, env);
  const second = await publishMarker(root, env);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.notEqual(first.stdout.trim(), second.stdout.trim());
  assert.equal(readdirSync(eventsDir(root, "factory")).length, 2);
  assert.equal(readdirSync(eventsDir(root, "factory")).some((name) => name.endsWith(".tmp")), false);
});

test("a busy lane requeues its snapshot so the wake-up event survives", async (t) => {
  const harness = laneHarness(t);
  const before = await publishMarker(harness.root, harness.env);
  assert.equal(before.code, 0, before.stderr);
  const initial = readdirSync(eventsDir(harness.root, "factory"));

  const lane = await runBash(harness.laneScript, ["factory"], envWith(harness, { LANE_STATUS: "75" }), harness.root);
  assert.equal(lane.code, 0, lane.stderr);
  const after = readdirSync(eventsDir(harness.root, "factory"));
  assert.equal(after.length, 1);
  assert.notDeepEqual(after, initial);
  assert.match(readFileSync(join(eventsDir(harness.root, "factory"), after[0]!), "utf8"), /requeue:1/);
});

test("a marker arriving during a pass is not acknowledged by that pass", async (t) => {
  const harness = laneHarness(t);
  const before = await publishMarker(harness.root, harness.env);
  assert.equal(before.code, 0, before.stderr);
  const initial = readdirSync(eventsDir(harness.root, "factory"));

  const lane = await runBash(
    harness.laneScript,
    ["factory"],
    envWith(harness, { ARRIVE_DURING_PASS: "1", LANE_STATUS: "0" }),
    harness.root,
  );
  assert.equal(lane.code, 0, lane.stderr);
  const remaining = readdirSync(eventsDir(harness.root, "factory"));
  assert.equal(remaining.length, 1);
  assert.notDeepEqual(remaining, initial);
});

test("a preflight fault alerts and keeps its original exit status", async (t) => {
  const harness = laneHarness(t);
  const lane = await runBash(
    harness.laneScript,
    ["factory"],
    envWith(harness, { RUNTIME_STATUS: "23" }),
    harness.root,
  );
  assert.equal(lane.code, 23);
  assert.equal(existsSync(harness.laneCalls), false);
  assert.match(readFileSync(harness.alertCalls, "utf8"), /runtime preflight exited 23/);
  assert.match(readFileSync(join(harness.root, ".sandcastle/logs/factory-alerts.log"), "utf8"), /factory/);
});

test("a lane fault alerts and keeps its original exit status", async (t) => {
  const harness = laneHarness(t);
  const lane = await runBash(
    harness.laneScript,
    ["dependabot"],
    envWith(harness, { LANE_STATUS: "42" }),
    harness.root,
  );
  assert.equal(lane.code, 42);
  assert.match(readFileSync(harness.alertCalls, "utf8"), /lane exited 42/);
});

test("exit statuses 0, 75 and 143 are clean and silent", async (t) => {
  for (const status of ["0", "75", "143"]) {
    const harness = laneHarness(t);
    const lane = await runBash(
      harness.laneScript,
      ["triage"],
      envWith(harness, { LANE_STATUS: status }),
      harness.root,
    );
    assert.equal(lane.code, 0, `status ${status} was not treated as clean`);
    assert.equal(existsSync(harness.alertCalls), false, `status ${status} sent an alert`);
  }
});

test("alerts deduplicate repeats and bound the alert log", async (t) => {
  const harness = laneHarness(t);
  const env = envWith(harness, { SANDCASTLE_ALERT_LOG_MAX_BYTES: "300" });
  for (const message of ["lane exited 7", "lane exited 7", "lane exited 8"]) {
    const alert = await runBash(harness.alertScript, ["--unit", "sandcastle-factory", message], env, harness.root);
    assert.equal(alert.code, 0, alert.stderr);
  }
  const calls = readFileSync(harness.alertCalls, "utf8").trim().split("\n");
  assert.equal(calls.length, 2, "identical faults were not deduplicated");
  const log = join(harness.root, ".sandcastle/logs/factory-alerts.log");
  assert.ok(readFileSync(log).length <= 300);
  const stateFiles = readdirSync(join(harness.root, ".sandcastle/logs/alert-state"));
  assert.ok(stateFiles.length <= 4);
});

test("the agent Gradle wrapper gates Gradle and honours the held marker", async (t) => {
  const root = makeRoot(t);
  mkdirSync(join(root, ".sandcastle/agent/bin"), { recursive: true });
  mkdirSync(join(root, ".sandcastle/agent/cli"), { recursive: true });
  const wrapper = join(root, ".sandcastle/agent/bin/gradle");
  copyFileSync(join(sandcastleDir, "agent/bin/gradle"), wrapper);
  chmodSync(wrapper, 0o755);
  writeFileSync(join(root, ".sandcastle/agent/cli/gradle.mts"), "");
  const gradleCalls = join(root, "gradle-calls.txt");
  const gateArgv = join(root, "gate-argv.txt");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeScript(join(bin, "node"), [
    "#!/bin/sh",
    'for arg in "$@"; do case "$arg" in *gradle.mts*) printf "%s\\n" "$*" >> "$GRADLE_CALLS"; exit 0;; esac; done',
    'exec "$REAL_NODE" "$@"',
    "",
  ].join("\n"));
  writeScript(join(root, "gate"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${gateArgv}\nexit 0\n`);

  const base: Record<string, string> = {
    ...process.env,
    PATH: `${bin}:${nodeDir}:${process.env.PATH ?? ""}`,
    REAL_NODE: process.execPath,
    GRADLE_CALLS: gradleCalls,
    GATE_ARGV: gateArgv,
    MACOS_HEAVY_WORK_GATE: join(root, "gate"),
    SANDCASTLE_HEAVY_WORK_WAIT_SECONDS: "11",
    SANDCASTLE_HEAVY_WORK_TIMEOUT_SECONDS: "22",
  };
  const gated = await runBash(wrapper, ["desktopTest"], base, root);
  assert.equal(gated.code, 0, gated.stderr);
  assert.deepEqual(readFileSync(gateArgv, "utf8").trim().split("\n"), [
    "--label", "agent-gradle",
    "--wait", "11",
    "--timeout", "22",
    "--", "node", `${root}/.sandcastle/agent/bin/../cli/gradle.mts`, "desktopTest",
  ]);
  assert.equal(existsSync(gradleCalls), false);

  const held = await runBash(wrapper, ["desktopTest"], { ...base, MAC_HEAVY_WORK_HELD: "1" }, root);
  assert.equal(held.code, 0, held.stderr);
  assert.match(readFileSync(gradleCalls, "utf8"), /gradle\.mts desktopTest/);
});
