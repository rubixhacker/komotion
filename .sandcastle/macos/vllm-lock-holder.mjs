import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * The macOS lease holder for one vLLM model slot.
 *
 * GNU flock is not on macOS. This holds the same kind of cross-process lease
 * with an atomic PID file and releases it on stdin EOF, on a signal, or when
 * this process dies. The model-budget code keeps stdin open for as long as it
 * owns the slot, exactly as it does with the flock holder on Bazzite.
 */

const [lockPath] = process.argv.slice(2);
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const MARKER = "model-budget-lease-v1\n";

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
        if (Date.now() - statSync(lockPath).mtimeMs < STALE_AFTER_MS) return false;
      } catch {
        // Reclaim a dead owner's lease.
      }
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // Another contender won; the next attempt decides.
    }
    return acquire();
  }
}

if (!acquire()) process.exit(75);

let released = false;
function release() {
  if (released) return;
  released = true;
  if (ownerPid() === process.pid) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already removed.
    }
  }
}
process.on("exit", release);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    release();
    process.exit(0);
  });
}

process.stdout.on("error", () => {
  release();
  process.exit(0);
});
process.stdin.on("error", () => {
  release();
  process.exit(0);
});
process.stdin.on("end", () => {
  release();
  process.exit(0);
});
process.stdin.resume();
process.stdout.write(MARKER);
