import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * The macOS equivalent of `flock --no-fork`: hold a factory lease for the
 * lifetime of one child process, then release it. GNU flock is not part of
 * macOS. A PID file with an atomic exclusive create gives the same semantics:
 * a live owner keeps the lease, a dead owner's lease is reclaimed.
 */

const [lockPath, wait, program, ...args] = process.argv.slice(2);
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function ownerPid() {
  try {
    const text = readFileSync(lockPath, "utf8").trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  }
}

function acquire() {
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const pid = ownerPid();
    if (pid !== null && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age < STALE_AFTER_MS) return false;
      } catch {
        // The owner is gone; fall through and reclaim its lease.
      }
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // Another contender reclaimed it first; the next attempt decides.
    }
    return acquire();
  }
}

let held = false;
function release() {
  if (!held) return;
  held = false;
  if (ownerPid() === process.pid) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already removed.
    }
  }
}

const deadline = Date.now() + (wait === "1" ? Number.MAX_SAFE_INTEGER : 0);
while (!acquire()) {
  if (wait !== "1" || Date.now() >= deadline) {
    process.exit(75);
  }
  await new Promise((done) => setTimeout(done, 500));
}
held = true;
process.on("exit", release);

const child = spawn(program, args, { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on("exit", (code, signal) => {
  release();
  process.exit(signal === null ? (code ?? 1) : 128 + (signal === "SIGKILL" ? 9 : 15));
});
