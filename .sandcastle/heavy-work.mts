// Injectable adapter for the Mac's heavy-work gate (Gradle/Xcode and git
// rebase). The gate is optional: without it the factory stays portable, and a
// caller that already holds the lock runs the program directly.

import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand, type CommandOptions, type CommandResult } from "./process.mts";

export const DEFAULT_HEAVY_WORK_WAIT_SECONDS = 300;
export const DEFAULT_HEAVY_WORK_TIMEOUT_SECONDS = 3_600;
export const HEAVY_WORK_HELD_ENV = "MAC_HEAVY_WORK_HELD";
export const HEAVY_WORK_GATE_ENV = "MACOS_HEAVY_WORK_GATE";
export const HEAVY_WORK_WAIT_ENV = "SANDCASTLE_HEAVY_WORK_WAIT_SECONDS";
export const HEAVY_WORK_TIMEOUT_ENV = "SANDCASTLE_HEAVY_WORK_TIMEOUT_SECONDS";

export type HeavyWorkRunner = (
  program: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandResult>;

export interface HeavyWorkOptions extends CommandOptions {
  readonly label: string;
  readonly program: string;
  readonly args?: readonly string[];
  readonly waitSeconds?: number;
  readonly timeoutSeconds?: number;
  /** Inject a command runner in tests; production uses process.runCommand. */
  readonly run?: HeavyWorkRunner;
}

function seconds(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function configuredSeconds(value: number | undefined, name: string, fallback: number): number {
  if (value !== undefined) return seconds(value, name);
  const raw = process.env[name];
  return raw === undefined ? fallback : seconds(Number(raw), name);
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a heavy program through the configured gate, or directly when the gate
 * is absent or the caller already holds the lock. A gate exit of 75 is a
 * deferral: the caller sees the untouched CommandResult and may retry later.
 */
export async function runHeavyWork(options: HeavyWorkOptions): Promise<CommandResult> {
  if (typeof options.label !== "string" || options.label.trim() === "") {
    throw new TypeError("heavy work needs a label");
  }
  const waitSeconds = configuredSeconds(options.waitSeconds, HEAVY_WORK_WAIT_ENV, DEFAULT_HEAVY_WORK_WAIT_SECONDS);
  const timeoutSeconds = configuredSeconds(
    options.timeoutSeconds,
    HEAVY_WORK_TIMEOUT_ENV,
    DEFAULT_HEAVY_WORK_TIMEOUT_SECONDS,
  );
  const runner = options.run ?? runCommand;
  const common: CommandOptions = {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.maxTailBytes === undefined ? {} : { maxTailBytes: options.maxTailBytes }),
    ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs }),
    ...(options.input === undefined ? {} : { input: options.input }),
  };
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  const held = env[HEAVY_WORK_HELD_ENV] === "1";

  if (held) {
    // Keep the marker for descendants so they do not acquire the same lock.
    env[HEAVY_WORK_HELD_ENV] = "1";
    return runner(options.program, options.args ?? [], {
      ...common,
      env,
      timeoutMs: options.timeoutMs ?? (timeoutSeconds + 5) * 1000,
    });
  }

  const configuredGate = env[HEAVY_WORK_GATE_ENV];
  if (configuredGate === undefined || configuredGate === "") {
    return runner(options.program, options.args ?? [], {
      ...common,
      env,
      timeoutMs: options.timeoutMs ?? (timeoutSeconds + 5) * 1000,
    });
  }

  const gate = resolve(options.cwd ?? process.cwd(), configuredGate);
  if (!existsSync(gate) || !executable(gate)) {
    return runner(options.program, options.args ?? [], {
      ...common,
      env,
      timeoutMs: options.timeoutMs ?? (timeoutSeconds + 5) * 1000,
    });
  }

  const args = [
    "--label", options.label,
    "--wait", String(waitSeconds),
    "--timeout", String(timeoutSeconds),
    "--",
    options.program,
    ...(options.args ?? []),
  ];
  // The outer bound covers the gate's wait plus the heavy operation, with a
  // small grace margin for the gate to report a clean exit.
  return runner(gate, args, {
    ...common,
    env,
    timeoutMs: options.timeoutMs ?? (waitSeconds + timeoutSeconds + 10) * 1000,
  });
}
