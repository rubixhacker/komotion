import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  laneWiringProblems,
  laneWiringProblemsForRoot,
  parseLaneManifest,
  type WiringSurfaces,
} from "./lane-wiring.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const lane = parseLaneManifest(
  JSON.stringify({
    lanes: [
      {
        name: "new-lane",
        entry: "new-lane",
        interval: 600,
        runAtLoad: false,
        watchPath: ".sandcastle/logs/new-lane-events",
        doc: "lanes/new-lane.md",
        packageScript: "new-lane",
        checkScript: "new-lane:check",
        readme: { title: "New lane", entry: "new-lane.mts", writesTo: "nothing" },
      },
    ],
  }),
);

const readme = [
  "| Lane | Entry | Launchd agent | Writes to | Document |",
  "| --- | --- | --- | --- | --- |",
  "| New lane | `new-lane.mts` | `com.rubixhacker.sandcastle.new-lane` | nothing | [lanes/new-lane.md](lanes/new-lane.md) |",
  "",
].join("\n");

function surfaces(overrides: Partial<WiringSurfaces> = {}): WiringSurfaces {
  return {
    installer: '#!/bin/bash\nmanifest="$root/.sandcastle/lanes/manifest.json"\n',
    wrapper: 'entry=$(python3 - "$manifest" <<\'PY\'\n# reads .sandcastle/lanes/manifest.json\nPY\n)',
    readme,
    packageJson:
      '{"scripts":{"new-lane":"tsx new-lane.mts","new-lane:check":"tsx new-lane.mts --check"}}',
    template: "__LANE__ __INTERVAL__ __RUNATLOAD__ __WATCHPATHS__",
    entries: ["new-lane.mts"],
    docs: ["new-lane.md"],
    ...overrides,
  };
}

test("the repository's lane definitions match every wired surface", () => {
  assert.deepEqual(laneWiringProblemsForRoot(repositoryRoot), []);
});

test("an event-driven lane needs no interval to be fully wired", () => {
  // Given: the same lane, with a null interval instead of a polling timer.
  const eventLane = parseLaneManifest(
    JSON.stringify({ lanes: [{ ...lane.lanes?.[0], interval: null }] }),
  );
  // Then: the gate accepts it because RunAtLoad and WatchPaths remain wired.
  assert.deepEqual(laneWiringProblems(eventLane, surfaces()), []);
});

test("a lane entry with no definition fails the gate", () => {
  // Given: a README row and a lane doc that name a lane absent from the manifest.
  const strayRow =
    "| Stray | `stray.mts` | `com.rubixhacker.sandcastle.stray` | nothing | [lanes/stray.md](lanes/stray.md) |";
  const problems = laneWiringProblems(
    lane,
    surfaces({ readme: `${readme}${strayRow}\n`, docs: ["new-lane.md", "stray.md"] }),
  );
  // Then: the gate names both orphans so an author can wire or remove them.
  assert.ok(problems.includes('lane "stray" has no definition (README row)'));
  assert.ok(problems.includes('lane doc "stray.md" has no definition'));
});

test("a definition without an entry, doc or installer slot fails the gate", () => {
  // Given: a manifest lane with no entry, doc or timing/wake fields.
  const broken = parseLaneManifest(
    JSON.stringify({
      lanes: [
        {
          name: "new-lane",
          readme: { title: "New lane", entry: "new-lane.mts", writesTo: "nothing" },
        },
      ],
    }),
  );
  const problems = laneWiringProblems(broken, surfaces());
  // Then: the gate names each missing surface, not just the first one.
  assert.ok(problems.includes('lane "new-lane" has no entry'));
  assert.ok(problems.includes("lane \"new-lane\" has no doc <none>"));
  assert.ok(
    problems.includes("lane \"new-lane\" has no installer slot: interval is missing or invalid"),
  );
  assert.ok(problems.includes("lane \"new-lane\" has no installer slot: runAtLoad is missing"));
  assert.ok(
    problems.includes("lane \"new-lane\" has no installer slot: watchPath is missing or invalid"),
  );
});

test("a definition whose entry file or package script is missing fails the gate", () => {
  const noFile = laneWiringProblems(lane, surfaces({ entries: [] }));
  assert.ok(noFile.includes("entry file .sandcastle/new-lane.mts for lane \"new-lane\" is missing"));
  const noScript = laneWiringProblems(lane, surfaces({ packageJson: '{"scripts":{}}' }));
  assert.ok(noScript.includes('lane "new-lane" has no new-lane package script'));
  assert.ok(noScript.includes('lane "new-lane" has no new-lane:check package script'));
});

function checkout() {
  const root = mkdtempSync(join(tmpdir(), "sandcastle-lane-wiring-"));
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  mkdirSync(join(root, ".sandcastle/launchd"), { recursive: true });
  mkdirSync(join(root, ".sandcastle/lanes"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts/install-sandcastle-macos.sh"),
    join(root, "scripts/install-sandcastle-macos.sh"),
  );
  copyFileSync(
    join(repositoryRoot, "scripts/ci/sandcastle-lane.sh"),
    join(root, "scripts/ci/sandcastle-lane.sh"),
  );
  for (const template of [
    "com.rubixhacker.sandcastle.LANE.plist.template",
    "com.rubixhacker.sandcastle.review-server.plist.template",
    "com.rubixhacker.sandcastle.dispatch-runner.plist.template",
  ]) {
    copyFileSync(
      join(repositoryRoot, ".sandcastle/launchd", template),
      join(root, ".sandcastle/launchd", template),
    );
  }
  const source: unknown = JSON.parse(
    readFileSync(join(repositoryRoot, ".sandcastle/lanes/manifest.json"), "utf8"),
  );
  const current = source as { lanes: unknown[] };
  const added = {
    name: "new-lane",
    entry: "new-lane",
    interval: 777,
    runAtLoad: false,
    watchPath: ".sandcastle/logs/new-lane-events",
    doc: "lanes/new-lane.md",
    packageScript: "new-lane",
    checkScript: null,
    readme: { title: "New lane", entry: "new-lane.mts", writesTo: "nothing" },
  };
  writeFileSync(
    join(root, ".sandcastle/lanes/manifest.json"),
    JSON.stringify({ ...current, lanes: [...current.lanes, added] }, null, 2),
  );
  writeFileSync(join(root, "bin/plutil"), "#!/bin/bash\nexit 0\n");
  writeFileSync(
    join(root, "bin/node"),
    `#!/bin/bash\nprintf '%s\\n' "$@" >"${join(root, "node-args")}"\nexit 0\n`,
  );
  writeFileSync(join(root, "scripts/ci/sandcastle-runtime.sh"), "#!/bin/bash\nexit 0\n");
  for (const stub of ["bin/plutil", "bin/node", "scripts/ci/sandcastle-runtime.sh"]) {
    chmodSync(join(root, stub), 0o755);
  }
  const env = {
    HOME: root,
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    SANDCASTLE_RUNTIME_DIR: root,
  };
  // The installer uses the default runtime path, as it does on the host.
  const installEnv = { HOME: root, PATH: env.PATH };
  return {
    root,
    env,
    installEnv,
    agents: join(root, "Library/LaunchAgents"),
    nodeArgs: () => readFileSync(join(root, "node-args"), "utf8").trim().split("\n"),
    lane: (name: string) =>
      spawnSync("bash", [join(root, "scripts/ci/sandcastle-lane.sh"), name], {
        encoding: "utf8",
        env,
      }),
  };
}

test("adding a lane to the manifest installs its interval and watch path without array edits", () => {
  // Given: a host with the repository's installer and a manifest that has one
  // more lane than the installer has ever seen.
  const host = checkout();
  // When: the installer writes the agents.
  const install = spawnSync("bash", [join(host.root, "scripts/install-sandcastle-macos.sh")], {
    encoding: "utf8",
    env: host.installEnv,
  });
  assert.equal(install.status, 0, install.stderr);
  // Then: the new lane has its own agent with the manifest's interval and wake
  // folder, while a lane without a watch path has no WatchPaths key.
  const plist = readFileSync(
    join(host.agents, "com.rubixhacker.sandcastle.new-lane.plist"),
    "utf8",
  );
  assert.ok(plist.includes("<string>com.rubixhacker.sandcastle.new-lane</string>"));
  assert.ok(plist.includes("<string>new-lane</string>"));
  assert.ok(plist.includes("<integer>777</integer>"));
  assert.ok(
    plist.includes(
      join(host.root, "Workspace/komotion-factory/.sandcastle/logs/new-lane-events"),
    ),
  );
  const dependabot = readFileSync(
    join(host.agents, "com.rubixhacker.sandcastle.dependabot.plist"),
    "utf8",
  );
  assert.ok(dependabot.includes("<integer>1800</integer>"));
  rmSync(host.root, { recursive: true, force: true });
});

test("the factory and triage lanes install with events as their only wake", () => {
  // Given: a host with the repository's installer and its current manifest.
  const host = checkout();
  const install = spawnSync("bash", [join(host.root, "scripts/install-sandcastle-macos.sh")], {
    encoding: "utf8",
    env: host.installEnv,
  });
  assert.equal(install.status, 0, install.stderr);
  // Then: neither event-driven lane has a polling timer. The factory keeps its
  // marker WatchPaths and RunAtLoad; triage keeps its RunAtLoad as configured.
  const factory = readFileSync(
    join(host.agents, "com.rubixhacker.sandcastle.factory.plist"),
    "utf8",
  );
  assert.ok(!factory.includes("<key>StartInterval</key>"));
  assert.ok(factory.includes("<key>RunAtLoad</key>"));
  assert.ok(factory.includes("<true/>"));
  assert.ok(factory.includes(join(host.root, "Workspace/komotion-factory/.sandcastle/logs/factory-events")));
  const triage = readFileSync(
    join(host.agents, "com.rubixhacker.sandcastle.triage.plist"),
    "utf8",
  );
  assert.ok(!triage.includes("<key>StartInterval</key>"));
  assert.ok(triage.includes("<key>RunAtLoad</key>"));
  assert.ok(triage.includes("<false/>"));
  assert.ok(triage.includes(join(host.root, "Workspace/komotion-factory/.sandcastle/logs/triage-events")));
  rmSync(host.root, { recursive: true, force: true });
});

test("the wrapper accepts a manifest lane and rejects an unknown one", () => {
  const host = checkout();
  const added = host.lane("new-lane");
  assert.equal(added.status, 0, added.stderr);
  assert.ok(host.nodeArgs().includes(".sandcastle/new-lane.mts"));
  const factory = host.lane("factory");
  assert.equal(factory.status, 0, factory.stderr);
  assert.ok(host.nodeArgs().includes(".sandcastle/drain.mts"));
  const unknown = host.lane("stray");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown lane stray/);
  rmSync(host.root, { recursive: true, force: true });
});
