// Validation for the factory and triage environment checks.
//
// A one-line host bug — an invalid gh subcommand, or a prompt argument that
// collides with a reserved built-in — would otherwise surface mid-pass,
// after a full planner-to-gate cycle of agent time. The check modes run
// these validations before a pass starts.

import { command, CommandError } from "./process.mts";

export const GH_MAX_TAIL_BYTES = 16 * 1024 * 1024;

/**
 * Prompt arguments the sandcastle runtime injects into every file-based
 * prompt itself. A promptArgs key that collides with one of these makes
 * the run fail before the agent starts.
 */
export const RESERVED_PROMPT_ARGS: readonly string[] = [
  "SOURCE_BRANCH",
  "TARGET_BRANCH",
];

/**
 * One failure per prompt argument that collides with a built-in prompt
 * argument. `specs` pairs each agent run with the prompt arguments it
 * passes; the run's name goes into the failure message.
 */
export function promptArgFailures(
  specs: readonly (readonly [string, Record<string, string>])[],
): string[] {
  const failures: string[] = [];
  for (const [name, args] of specs) {
    for (const key of Object.keys(args)) {
      if (RESERVED_PROMPT_ARGS.includes(key))
        failures.push(`${name} passes built-in prompt argument ${key} via promptArgs`);
    }
  }
  return failures;
}

/**
 * One failure per gh subcommand the installed gh does not have. Each
 * command is probed with a bare invocation, which never mutates GitHub:
 * a missing subcommand is the only failure that means the command does
 * not exist (`unknown command "x" for "gh y"`); other failures (missing
 * arguments, no repository context) mean the command exists. `probe` runs
 * the probe and must throw with the gh output on failure.
 */
export async function ghCommandFailures(
  commands: readonly (readonly string[])[],
  probe: (command: readonly string[]) => Promise<unknown> = (args) =>
    // The probe's output is captured, not inherited: a failing probe's
    // error text goes into the error, not the lane's output.
    command("gh", [...args], { maxTailBytes: GH_MAX_TAIL_BYTES }),
): Promise<string[]> {
  const failures: string[] = [];
  for (const args of commands) {
    try {
      await probe(args);
    } catch (error) {
      if (/unknown command /.test(childErrorOutput(error)))
        failures.push(`gh has no '${args.join(" ")}' command`);
    }
  }
  return failures;
}

/** The gh output carried by a failed child-process error. */
export function childErrorOutput(error: unknown): string {
  if (error instanceof CommandError) {
    const text = [error.stdout, error.stderr].join("\n").trim();
    if (text !== "") return text;
    return error.message;
  }
  if (error instanceof Error) {
    const { stdout, stderr } = error as Error & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const text = [stdout, stderr]
      .map((value) => (value === undefined ? "" : value.toString()))
      .join("\n")
      .trim();
    if (text !== "") return text;
    return error.message;
  }
  return String(error);
}
