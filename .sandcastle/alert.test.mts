import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/sandcastle-alert.sh", import.meta.url));

/**
 * A throwaway checkout with the real alert script, a stub `npm` that prints a
 * status line, and a stub `notify-send` that records each notification.
 */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), "sandcastle-alert-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".sandcastle"));
  mkdirSync(join(root, "bin"));
  copyFileSync(script, join(root, "scripts/sandcastle-alert.sh"));
  chmodSync(join(root, "scripts/sandcastle-alert.sh"), 0o755);
  writeFileSync(join(root, "bin/npm"), "#!/bin/bash\necho 'running planning, updated 5m ago'\nexit 1\n");
  writeFileSync(
    join(root, "bin/notify-send"),
    `#!/bin/bash\nprintf '%s\\n' "$2" >>"${join(root, "notifications")}"\n`,
  );
  chmodSync(join(root, "bin/npm"), 0o755);
  chmodSync(join(root, "bin/notify-send"), 0o755);
  const alert = (args: readonly string[], env: Record<string, string> = {}) => {
    const result = spawnSync("bash", [join(root, "scripts/sandcastle-alert.sh"), ...args], {
      encoding: "utf8",
      env: {
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/dev/null",
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const logPath = join(root, ".sandcastle/logs/factory-alerts.log");
  return {
    root,
    alert,
    entries: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => /^\d{4}-\d{2}-\d{2}T/.test(line))
        : [],
    log: () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : ""),
    notifications: () =>
      existsSync(join(root, "notifications"))
        ? readFileSync(join(root, "notifications"), "utf8").trim().split("\n")
        : [],
    stateFiles: () =>
      readdirSync(join(root, ".sandcastle/logs/alert-state")).map((name) =>
        join(root, ".sandcastle/logs/alert-state", name),
      ),
  };
}

test("an alert names the unit that failed, not the factory", () => {
  // Given: the Dependabot watchdog fails, as it did 66 times on 11 November
  // while every alert said sandcastle-factory.service.
  const host = checkout();
  // When: its alert instance runs.
  host.alert(["--unit", "sandcastle-dependabot.service", "failed"]);
  // Then: the log and the notification name that unit.
  assert.match(host.entries()[0] ?? "", / sandcastle-dependabot\.service failed$/);
  assert.equal(host.notifications()[0], "Sandcastle: sandcastle-dependabot.service failed");
  assert.match(host.log(), /running planning, updated 5m ago/);
});

test("a failure that recurs every thirty seconds is one entry, not hundreds", () => {
  // Given: a unit whose start check fails on every restart for five hours.
  const host = checkout();
  // When: its alert fires 600 times inside the repeat window. (Twenty here; the count is not the point.)
  for (let count = 0; count < 20; count += 1)
    host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  // Then: one log entry and one notification, and the repeats are counted.
  assert.equal(host.entries().length, 1);
  assert.equal(host.notifications().length, 1);
  assert.match(readFileSync(host.stateFiles()[0] ?? "", "utf8"), /^19 /);
});

test("a still-failing unit is reported again once the repeat window has passed, with the count", () => {
  const host = checkout();
  for (let count = 0; count < 4; count += 1)
    host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  // When: the last entry is older than the window.
  const state = host.stateFiles()[0] ?? "";
  const [suppressed, first] = readFileSync(state, "utf8").trim().split(" ");
  writeFileSync(state, `${suppressed} ${first} ${Math.floor(Date.now() / 1000) - 7 * 3600}\n`);
  host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  // Then: a second entry says how many repeats it stands for.
  assert.equal(host.entries().length, 2);
  assert.match(host.log(), /repeated 3 more time\(s\) since /);
  assert.equal(host.notifications().length, 2);
});

test("different units and different messages are separate alerts", () => {
  const host = checkout();
  host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  host.alert(["--unit", "sandcastle-dependabot.service", "failed"]);
  host.alert(["ticket #7 handed to a human after 3 failed attempt(s)"]);
  host.alert(["ticket #8 handed to a human after 3 failed attempt(s)"]);
  host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  assert.equal(host.entries().length, 4);
  assert.match(host.entries()[2] ?? "", / factory ticket #7 handed to a human/);
  assert.equal(host.notifications()[2], "Sandcastle needs a human");
});

test("an alert unit installed before the template still reports through MONITOR_UNIT", () => {
  const host = checkout();
  host.alert(["failed to complete a pass"], { MONITOR_UNIT: "sandcastle-factory.service" });
  assert.match(host.entries()[0] ?? "", / sandcastle-factory\.service failed to complete a pass$/);
});

test("a corrupt repeat record does not silence the alert", () => {
  const host = checkout();
  host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  writeFileSync(host.stateFiles()[0] ?? "", "garbage here now\n");
  host.alert(["--unit", "sandcastle-etl.service", "failed"]);
  assert.equal(host.entries().length, 2);
});
