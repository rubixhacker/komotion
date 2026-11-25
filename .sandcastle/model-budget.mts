import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFLICT_EXIT_CODE = 75;
const POLL_INTERVAL_MS = 50;
// A lock-holder process can take longer than five seconds to report readiness on a loaded CI
// runner; the budget is about lock ownership, not startup speed.
const HOLDER_START_TIMEOUT_MS = 15_000;
const HOLDER_STOP_GRACE_MS = 2_000;
const HOLDER_PROTOCOL = "model-budget-lease-v1";

interface HolderExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface LockHolder {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<HolderExit>;
  readonly exit: () => HolderExit | undefined;
  readonly stderr: () => string;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Model budget wait was aborted");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function slotCount(override: number | undefined): number {
  const configured = override ?? Number(process.env.SANDCASTLE_VLLM_PARALLELISM ?? "2");
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new RangeError("vLLM parallelism must be a positive integer");
  }
  return configured;
}

function lockDirectory(override: string | undefined): string {
  // Keep the machine-wide default aligned with the factory's other lease users.
  return resolve(
    override ??
      process.env.SANDCASTLE_LOCK_DIR ??
      resolve(process.env.HOME ?? "", ".local/share/komotion-locks"),
  );
}

function watchHolder(child: ChildProcessWithoutNullStreams): LockHolder {
  let exit: HolderExit | undefined;
  let stderr = "";
  // A child can report a post-start IPC error even after acquisition. Keep an
  // error listener for the whole child lifetime so it cannot crash the parent.
  child.on("error", () => {});
  // EPIPE is expected when a holder died before its parent released stdin.
  child.stdin.on("error", () => {});
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 8_192) stderr = (stderr + String(chunk)).slice(0, 8_192);
  });
  const exited = new Promise<HolderExit>((resolveExit) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolveExit(exit);
    });
  });
  return { child, exited, exit: () => exit, stderr: () => stderr };
}

async function exitsWithin(holder: LockHolder, timeoutMs: number): Promise<boolean> {
  if (holder.exit()) return true;
  return await new Promise<boolean>((resolveWait) => {
    const timeout = setTimeout(() => resolveWait(false), timeoutMs);
    void holder.exited.then(() => {
      clearTimeout(timeout);
      resolveWait(true);
    });
  });
}

async function stopHolder(holder: LockHolder): Promise<void> {
  if (
    !holder.exit() &&
    !holder.child.stdin.writableEnded &&
    !holder.child.stdin.destroyed
  ) {
    holder.child.stdin.end();
  }
  if (await exitsWithin(holder, HOLDER_STOP_GRACE_MS)) return;

  // The inline holder normally exits as soon as stdin closes. Do not let a
  // damaged helper make release wait forever, but only return after it is dead.
  holder.child.kill("SIGKILL");
  if (await exitsWithin(holder, HOLDER_STOP_GRACE_MS)) return;
  throw new Error(`vLLM lock holder ${holder.child.pid ?? "unknown"} did not exit`);
}

async function trySlot(
  lockPath: string,
  signal: AbortSignal | undefined,
): Promise<LockHolder | null> {
  throwIfAborted(signal);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./macos/vllm-lock-holder.mjs", import.meta.url)), lockPath],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const holder = watchHolder(child);

  try {
    const acquired = await new Promise<boolean>((resolveAttempt, rejectAttempt) => {
      let settled = false;
      let stdout = "";
      const timeout = setTimeout(() => {
        fail(new Error(`Timed out starting vLLM lock holder for ${lockPath}`));
      }, HOLDER_START_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        child.stdout.off("data", onData);
        child.off("error", onError);
      };
      const succeed = (value: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveAttempt(value);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectAttempt(error);
      };
      const onAbort = () => fail(abortReason(signal as AbortSignal));
      const onError = (error: Error) => fail(error);
      const onData = (chunk: Buffer | string) => {
        stdout += String(chunk);
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        const message = stdout.slice(0, newline).trim();
        if (message === HOLDER_PROTOCOL) succeed(true);
        else fail(new Error(`Unexpected vLLM lock holder response: ${message}`));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      child.once("error", onError);
      child.stdout.on("data", onData);
      void holder.exited.then(({ code, signal: exitSignal }) => {
        if (code === CONFLICT_EXIT_CODE) {
          succeed(false);
          return;
        }
        const status = exitSignal ? `signal ${exitSignal}` : `status ${code ?? "unknown"}`;
        const detail = holder.stderr().trim();
        fail(
          new Error(
            `vLLM lock holder for ${lockPath} exited before acquisition (${status})${
              detail ? `: ${detail}` : ""
            }`,
          ),
        );
      });
      if (signal?.aborted) onAbort();
    });

    throwIfAborted(signal);
    return acquired ? holder : null;
  } catch (error) {
    await stopHolder(holder);
    throw error;
  }
}

async function acquire(
  directory: string,
  slots: number,
  signal: AbortSignal | undefined,
): Promise<LockHolder> {
  await mkdir(directory, { recursive: true });
  for (;;) {
    throwIfAborted(signal);
    for (let slot = 0; slot < slots; slot += 1) {
      const holder = await trySlot(resolve(directory, `vllm-model-${slot}.lock`), signal);
      if (holder) return holder;
      throwIfAborted(signal);
    }
    await new Promise<void>((resolveWait, rejectWait) => {
      const timeout = setTimeout(done, POLL_INTERVAL_MS);
      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        rejectWait(abortReason(signal as AbortSignal));
      };
      function done() {
        signal?.removeEventListener("abort", onAbort);
        resolveWait();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

/**
 * Runs one vLLM orchestration tree under a machine-wide advisory lease. Nested
 * non-vLLM work bypasses acquisition, so a Qwen tree that calls a cloud model
 * still consumes only the outer lease.
 */
export async function withModelBudget<T>(
  model: string,
  fn: () => Promise<T>,
  options: {
    slots?: number;
    lockDirectory?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  if (!model.startsWith("vllm/")) return await fn();

  throwIfAborted(options.signal);
  const holder = await acquire(
    lockDirectory(options.lockDirectory),
    slotCount(options.slots),
    options.signal,
  );
  try {
    throwIfAborted(options.signal);
    return await fn();
  } finally {
    await stopHolder(holder);
  }
}
