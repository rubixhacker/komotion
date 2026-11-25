// Bounded host subprocesses. Sandcastle's sandbox.run/sandbox.exec already
// supervise their own process groups; this module is only for commands the
// factory host runs directly (gh, git, the delivery gate and preflight probes).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TAIL_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 1_000;

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  /** Wall-clock limit for the whole command. Zero disables the limit. */
  readonly timeoutMs?: number;
  /** Maximum bytes retained from each output stream. */
  readonly maxTailBytes?: number;
  /** Grace period between TERM and KILL when a command is stopped. */
  readonly killGraceMs?: number;
  readonly input?: string;
}

export interface CommandResult {
  readonly command: readonly string[];
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export type CommandErrorKind = "spawn" | "exit" | "signal" | "timeout" | "aborted" | "invalid-json";

/** A failed host command with bounded output and machine-readable fields. */
export class CommandError extends Error {
  readonly kind: CommandErrorKind;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;

  constructor(details: {
    kind: CommandErrorKind;
    command: readonly string[];
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
    message?: string;
    cause?: unknown;
  }) {
    super(details.message ?? defaultMessage(details.kind, details.command, details.exitCode, details.signal), {
      cause: details.cause,
    });
    this.name = "CommandError";
    this.kind = details.kind;
    this.command = [...details.command];
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.durationMs = details.durationMs ?? 0;
  }
}

function defaultMessage(
  kind: CommandErrorKind,
  command: readonly string[],
  exitCode: number | null | undefined,
  signal: NodeJS.Signals | null | undefined,
): string {
  const name = command.join(" ");
  switch (kind) {
    case "spawn":
      return `could not start ${name}`;
    case "exit":
      return `${name} exited ${exitCode}`;
    case "signal":
      return `${name} was stopped by ${signal ?? "a signal"}`;
    case "timeout":
      return `${name} timed out`;
    case "aborted":
      return `${name} was aborted`;
    case "invalid-json":
      return `${name} returned invalid JSON`;
  }
}

/** Keep only the newest bytes without buffering an unbounded child output. */
class OutputTail {
  private readonly chunks: Buffer[] = [];
  private length = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    if (this.limit === 0 || chunk.length === 0) return;
    const kept = chunk.subarray(Math.max(0, chunk.length - this.limit));
    this.chunks.push(kept);
    this.length += kept.length;
    while (this.length > this.limit) {
      const excess = this.length - this.limit;
      const first = this.chunks[0];
      if (first === undefined) break;
      if (first.length <= excess) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.length -= excess;
      }
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.length).toString("utf8");
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function killGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32" || child.pid === undefined) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The group may already be gone. A direct kill also covers platforms that
    // did not create a separate group despite detached:true.
    try {
      child.kill(signal);
    } catch {
      // Nothing left to stop.
    }
  }
}

/**
 * Run a host command in its own process group and resolve with bounded output.
 * Nonzero exits are returned; command() turns them into structured errors.
 * Timeouts and aborts always TERM the group, then KILL any survivors.
 */
export async function runCommand(
  program: string,
  args: readonly string[] = [],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = nonNegativeInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxTailBytes = nonNegativeInteger(options.maxTailBytes ?? DEFAULT_MAX_TAIL_BYTES, "maxTailBytes");
  const killGraceMs = nonNegativeInteger(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS, "killGraceMs");
  const command = [program, ...args];
  const started = Date.now();
  const stdout = new OutputTail(maxTailBytes);
  const stderr = new OutputTail(maxTailBytes);

  if (options.signal?.aborted) {
    throw new CommandError({
      kind: "aborted",
      command,
      durationMs: Date.now() - started,
      cause: options.signal.reason,
    });
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(program, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  } catch (cause) {
    throw new CommandError({ kind: "spawn", command, cause, durationMs: Date.now() - started });
  }

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  // Commands that do not consume stdin must not block, and a command that
  // exits early must not turn its closed pipe into an unhandled EPIPE.
  child.stdin.on("error", () => {});
  child.stdin.end(options.input);

  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    let termination: "timeout" | "aborted" | null = null;
    let abortCause: unknown;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: CommandError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const stop = (reason: "timeout" | "aborted", cause?: unknown): void => {
      if (settled || termination !== null) return;
      termination = reason;
      abortCause = cause;
      killGroup(child, "SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) killGroup(child, "SIGKILL");
      }, killGraceMs);
      killTimer.unref();
    };

    const onAbort = (): void => stop("aborted", options.signal?.reason);

    child.once("error", (cause) => {
      fail(new CommandError({
        kind: "spawn",
        command,
        cause,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - started,
      }));
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result: CommandResult = {
        command,
        code,
        signal,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - started,
      };
      if (termination === "timeout") {
        reject(new CommandError({
          kind: "timeout",
          command,
          exitCode: code,
          signal,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
        }));
      } else if (termination === "aborted") {
        reject(new CommandError({
          kind: "aborted",
          command,
          exitCode: code,
          signal,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          cause: abortCause,
        }));
      } else {
        resolve(result);
      }
    });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => stop("timeout"), timeoutMs);
      timeoutTimer.unref();
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run a command and return stdout, throwing a CommandError on failure. */
export async function command(
  program: string,
  args: readonly string[] = [],
  options: CommandOptions = {},
): Promise<string> {
  const result = await runCommand(program, args, options);
  assertCommandSuccess(result);
  return result.stdout;
}

/** Run a command and parse its stdout as JSON. */
export async function commandJson<T>(
  program: string,
  args: readonly string[] = [],
  options: CommandOptions = {},
): Promise<T> {
  const output = await command(program, args, options);
  try {
    return JSON.parse(output) as T;
  } catch (cause) {
    throw new CommandError({
      kind: "invalid-json",
      command: [program, ...args],
      stdout: output,
      message: `${program} returned invalid JSON`,
      cause,
    });
  }
}

/** Throw a structured error unless a result represents a successful exit. */
export function assertCommandSuccess(result: CommandResult): void {
  if (result.code === 0) return;
  throw new CommandError({
    kind: result.signal === null ? "exit" : "signal",
    command: result.command,
    exitCode: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  });
}

/** Git must never open an editor or prompt on the unattended factory host. */
export function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
  };
}
