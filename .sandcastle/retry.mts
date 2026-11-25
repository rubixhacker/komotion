/**
 * Run a read that can fail for a moment, such as a GitHub API call, up to
 * `attempts` times. `pause` waits before each retry and is told which attempt
 * just failed. The last failure is thrown.
 *
 * Only reads go through here: repeating a write could do it twice.
 */
export function withRetries<T>(
  attempts: number,
  read: () => T,
  pause: (failedAttempt: number) => void,
): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return read();
    } catch (error) {
      if (attempt >= attempts) throw error;
      pause(attempt);
    }
  }
}

/** Blocks this thread for `ms`; the factory's host commands are synchronous. */
export function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Whether an agent run's failure says its process was killed from outside its
 * own control flow: exit 137 is SIGKILL and 143 is SIGTERM. The factory stops
 * an agent through an abort signal, which it recognises separately, so a kill
 * it did not send came from inside the sandbox. On 15 November an author ran
 * `pkill -f "mobai-dev start"` to stop a device server; the pattern was also
 * in its own command line, the agent died with the work finished, and the
 * ticket took a strike.
 */
export function agentWasKilled(message: string): boolean {
  return /exited with code (?:137|143)\b/.test(message);
}

/**
 * Whether an agent run's failure says the agent went silent: the library stops
 * a run that emits nothing for its idle limit. The agent is then stuck, on a
 * command that never returns or a model that never answers, which is a stall
 * like a repeated call or a spent budget. On 15 November a repair ran its
 * checks green, went silent on one command for 30 minutes, and the run was
 * thrown away as an error: its uncommitted fixes and the review findings it
 * was working from were not kept for the next attempt.
 */
export function agentWentSilent(message: string): boolean {
  return /\bAgent idle for \d+ seconds\b/.test(message);
}
