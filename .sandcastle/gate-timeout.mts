import type { ExecResult } from "@ai-hero/sandcastle";

/** The gate both gate sites run. */
export const GATE_COMMAND = "./gradlew qualityGate";

export interface BoundedGate {
  readonly result: ExecResult;
  readonly timedOut: boolean;
}

const faultResult = (message: string): ExecResult => ({
  exitCode: 1,
  stdout: "",
  stderr: message,
});

/**
 * Runs the gate under a time limit. A gate that overruns is killed inside the
 * sandbox and reported as timed out, so the caller reads it as the host's fault
 * instead of waiting forever: a hung gate once held a ticket for an hour, and
 * killing its processes by hand was the only way out.
 *
 * `kill` ends the gate's processes in the sandbox; the exec then settles as
 * they die. One that does not settle within `graceMs` of the kill gets a
 * synthetic failed result, so the bound holds even against a wedged exec.
 */
export async function boundedGateExec(
  exec: (command: string) => Promise<ExecResult>,
  kill: () => void,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  graceMs = 30_000,
): Promise<BoundedGate> {
  const gate = exec(GATE_COMMAND).then(
    (result) => ({ kind: "done" as const, result }),
    (error: unknown) => ({
      kind: "done" as const,
      result: faultResult(error instanceof Error ? error.message : String(error)),
    }),
  );
  let fire: () => void = () => {};
  const overrun = new Promise<{ kind: "overrun" }>((resolve) => {
    fire = () => resolve({ kind: "overrun" });
  });
  const timer = setTimeout(() => {
    kill();
    fire();
  }, timeoutMs);
  const winner = await Promise.race([gate, overrun]);
  if (winner.kind === "done") {
    clearTimeout(timer);
    return { result: winner.result, timedOut: false };
  }
  const settled = await Promise.race([
    gate,
    sleep(graceMs).then(() => null),
  ]);
  return {
    result:
      settled?.result ??
      faultResult(
        `the gate did not finish in ${Math.round(timeoutMs / 60_000)} minutes and was killed`,
      ),
    timedOut: true,
  };
}
