import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * Consecutive failures of one named operation, and when it may run again.
 *
 * A fixed restart delay only stops a failing lane until the next tick wakes
 * it, which starts the same attempts over: a broken sandbox image failed
 * 1,611 preflights in 21 hours that way. The streak is kept by the factory
 * itself, so a failure that repeats is retried on a widening interval and a
 * human is told once, however the process was started.
 */
export const Streak = z.object({
  /** What failed, with run-specific numbers removed, so a repeat compares equal. */
  fingerprint: z.string(),
  /** The last failure's own message, for the alert and the status line. */
  message: z.string(),
  count: z.number().int().positive(),
  firstAt: z.string().min(1),
  lastAt: z.string().min(1),
});
export type Streak = z.infer<typeof Streak>;

export const Streaks = z.record(z.string(), Streak);
export type Streaks = z.infer<typeof Streaks>;

export interface StreakPolicy {
  /** Failures in a row that are retried at once; the next one starts the backoff. */
  readonly freeRetries: number;
  readonly firstDelayMs: number;
  readonly maxDelayMs: number;
}

/** Two immediate retries, then 10, 20 and 40 minutes, then hourly. */
export const DEFAULT_STREAK_POLICY: StreakPolicy = {
  freeRetries: 2,
  firstDelayMs: 10 * 60_000,
  maxDelayMs: 60 * 60_000,
};

/**
 * Reduce an error to what repeats: the first line, with commit ids, run ids
 * and other long numbers replaced. `sandcastle/preflight-1794512371725` and
 * `sandcastle/preflight-1794512603096` are the same failure.
 */
export function failureFingerprint(scope: string, error: unknown): string {
  const message = failureMessage(error);
  const firstLine = message.split("\n").find((line) => line.trim() !== "") ?? "";
  const stable = firstLine
    .replaceAll(/\b[0-9a-f]{7,40}\b/g, "<id>")
    .replaceAll(/\d{4,}/g, "<n>")
    .trim()
    .slice(0, 300);
  return `${scope}|${stable}`;
}

export function failureMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `invalid data: ${error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The streak after one more failure: a different failure starts a new streak. */
export function afterFailure(
  prior: Streak | undefined,
  fingerprint: string,
  message: string,
  now: Date,
): Streak {
  const at = now.toISOString();
  if (prior === undefined || prior.fingerprint !== fingerprint)
    return { fingerprint, message, count: 1, firstAt: at, lastAt: at };
  return { ...prior, message, count: prior.count + 1, lastAt: at };
}

/** When the operation may next run, or null when it may run now. */
export function retryAfter(
  streak: Streak | undefined,
  now: Date,
  policy: StreakPolicy = DEFAULT_STREAK_POLICY,
): Date | null {
  if (streak === undefined || streak.count <= policy.freeRetries) return null;
  const last = Date.parse(streak.lastAt);
  // An unreadable timestamp must not hold the operation back forever.
  if (Number.isNaN(last)) return null;
  const doublings = Math.min(streak.count - policy.freeRetries - 1, 30);
  const delay = Math.min(policy.firstDelayMs * 2 ** doublings, policy.maxDelayMs);
  const at = new Date(last + delay);
  return at.getTime() > now.getTime() ? at : null;
}

/**
 * `retryAfter` for a streak recorded under `scope`. A streak from another
 * scope does not hold this one back: a pass streak is scoped to the factory's
 * commit, so deploying a fix retries at once instead of waiting out the
 * backoff the broken commit earned.
 */
export function retryAfterIn(
  scope: string,
  streak: Streak | undefined,
  now: Date,
  policy: StreakPolicy = DEFAULT_STREAK_POLICY,
): Date | null {
  if (streak === undefined || !streak.fingerprint.startsWith(`${scope}|`)) return null;
  return retryAfter(streak, now, policy);
}

/** True for exactly one failure of a streak: the one that starts the backoff. */
export function streakNeedsAlert(
  streak: Streak,
  policy: StreakPolicy = DEFAULT_STREAK_POLICY,
): boolean {
  return streak.count === policy.freeRetries + 1;
}

export function describeStreak(name: string, streak: Streak, retryAt: Date | null): string {
  const next = retryAt === null ? "retrying now" : `next attempt after ${retryAt.toISOString()}`;
  return `${name} failed ${streak.count} time(s) in a row since ${streak.firstAt} (${streak.message.split("\n")[0]?.slice(0, 300) ?? ""}); ${next}`;
}

/** An unreadable file is an empty record: losing a streak only costs one retry. */
export function readStreaks(path: string): Streaks {
  try {
    return Streaks.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function writeStreaks(path: string, streaks: Streaks): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(streaks, null, 2)}\n`);
  renameSync(temporary, path);
}

/** Record one failure of `name` and return its streak. */
export function recordFailure(
  path: string,
  name: string,
  fingerprint: string,
  message: string,
  now: Date,
): Streak {
  const streaks = readStreaks(path);
  const streak = afterFailure(streaks[name], fingerprint, message, now);
  writeStreaks(path, { ...streaks, [name]: streak });
  return streak;
}

/** Forget `name`'s streak after a success. Returns the streak that ended, if any. */
export function recordSuccess(path: string, name: string): Streak | undefined {
  const streaks = readStreaks(path);
  const ended = streaks[name];
  if (ended === undefined) return undefined;
  const { [name]: _removed, ...rest } = streaks;
  writeStreaks(path, rest);
  return ended;
}
