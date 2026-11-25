import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELD_FLAG = "--sandcastle-lock-held";

/**
 * One lock directory for the machine, not one per checkout. Otherwise a second
 * checkout of the same repo starts a second factory and the two never see
 * each other's lease.
 */
export function factoryLockPath(name: string): string {
  const dir =
    process.env.SANDCASTLE_LOCK_DIR ??
    resolve(process.env.HOME ?? "", ".local/share/komotion-locks");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, name);
}

export interface FactoryLockOptions {
  /**
   * Wait for a running pass instead of exiting 75. A phone "run a research pass now" request made
   * during a pass must run after it, not be dropped.
   */
  wait?: boolean;
}

export function enterFactoryLock(
  lockPath: string,
  script: string,
  options: FactoryLockOptions = {},
) {
  if (process.argv.includes(HELD_FLAG)) return;
  // The portable lease holder runs the child, keeps the lease for its lifetime
  // and exits 75 on contention when the caller asked not to wait.
  const childArguments = [
    process.execPath,
    ...process.execArgv,
    script,
    ...process.argv.slice(2),
    HELD_FLAG,
  ];
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./macos/lock-holder.mjs", import.meta.url)),
      lockPath,
      options.wait === true ? "1" : "0",
      ...childArguments,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status === 75)
    console.error(
      "Another Sandcastle factory run is already active. Wait for it to finish before starting another.",
    );
  process.exit(result.status ?? (result.signal === "SIGINT" ? 130 : 1));
}
