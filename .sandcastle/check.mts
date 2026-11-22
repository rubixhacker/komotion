// Validation for the factory and triage environment checks.
//
// A one-line host bug — an invalid gh subcommand, or a prompt argument that
// collides with a reserved built-in — would otherwise surface mid-pass,
// after a full planner-to-gate cycle of agent time. The check modes run
// these validations before a pass starts.

import { execFileSync } from "node:child_process";

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
 * the probe and must throw with the gh output on failure; the default
 * probe is a bare `gh <command...>`.
 */
export function ghCommandFailures(
  commands: readonly (readonly string[])[],
  probe: (command: readonly string[]) => void = (command) => {
    // The probe's output is captured, not inherited: a failing probe's
    // error text goes into the error, not the lane's output.
    execFileSync("gh", command, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  },
): string[] {
  const failures: string[] = [];
  for (const command of commands) {
    try {
      probe(command);
    } catch (error) {
      if (/unknown command /.test(childErrorOutput(error)))
        failures.push(`gh has no '${command.join(" ")}' command`);
    }
  }
  return failures;
}

/** The gh output carried by a failed child-process error. */
function childErrorOutput(error: unknown): string {
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
  }
  return String(error);
}
