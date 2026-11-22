import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A PID-file lease: the holder writes its pid on exclusive create. A lock
 * whose holder is gone (the process died without releasing) is stale and is
 * taken over. Returns a release function, or null when another live process
 * holds the lock.
 *
 * The lock file lives under .sandcastle/logs/, which is gitignored, so a
 * stale lock never dirties the checkout the runtime check requires.
 */
export function acquireLock(root: string, name: string): (() => void) | null {
  const file = resolve(root, ".sandcastle/logs", `${name}.lock`);
  mkdirSync(dirname(file), { recursive: true });
  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch {
    let holder = 0;
    try {
      holder = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    } catch {
      return null;
    }
    if (holder > 0 && isAlive(holder)) return null;
    try {
      fd = openSync(file, "w");
    } catch {
      return null;
    }
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => {
    try {
      if (Number.parseInt(readFileSync(file, "utf8").trim(), 10) === process.pid)
        rmSync(file);
    } catch {
      // the lock is gone or held by someone else; nothing to release
    }
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
