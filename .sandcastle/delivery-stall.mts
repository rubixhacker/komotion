import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * Whether the factory's deliveries have stalled.
 *
 * A delivery is a ticket the factory has pushed and opened as a pull request.
 * It fails when its head is escalated to a human after the factory's repair
 * rounds are spent (`.sandcastle/logs/ci-alerts.json`), and it stalls when no
 * new one has been opened for a configurable window. The exporter publishes
 * both signals and the stall decision, and the homelab Grafana alerts on it;
 * a healthy factory stays quiet.
 */

/** The window, in minutes, after which a delivery without a new one is stalled. */
export const DEFAULT_DELIVERY_STALL_MINUTES = 1440;

/**
 * Parse the configured delivery-stall window, in minutes.
 *
 * The window is a whole number of minutes: a value that is not one or more
 * ASCII decimal digits (after trimming surrounding whitespace) is malformed
 * and falls back to the default. The Python exporter applies the same rule to
 * `SANDCASTLE_DELIVERY_STALL_MINUTES`, so `npm run status` and the Grafana
 * alert never disagree on the window.
 */
export function parseDeliveryWindowMinutes(
  value: string | undefined,
  fallback: number = DEFAULT_DELIVERY_STALL_MINUTES,
): number {
  const raw = (value ?? "").trim();
  return /^[0-9]+$/.test(raw) ? Number(raw) : fallback;
}

/**
 * The one fact the factory records about its deliveries: when one last
 * happened. The status file's `delivered` count resets on every pass, so this
 * file is the only persistent record of the last delivery.
 */
export const DeliveryFacts = z.object({
  lastDeliveryAt: z.string().min(1).nullable(),
});
export type DeliveryFacts = z.infer<typeof DeliveryFacts>;

/** The delivery-failure signal and the stall decision derived from it. */
export const DeliveryStallState = z.object({
  /** The alert condition: a delivery failed, or the window has passed. */
  stalled: z.boolean(),
  /** A delivery has failed: its head was escalated to a human. */
  deliveryFailed: z.boolean(),
  /** No new delivery has been opened for the window. */
  noNewDelivery: z.boolean(),
  /** Seconds since the last delivery, or null when none is known. */
  lastDeliveryAgeSeconds: z.number().nullable(),
  /** The configured window in minutes. */
  windowMinutes: z.number(),
});
export type DeliveryStallState = z.infer<typeof DeliveryStallState>;

/** A missing or unreadable facts file is one with no known delivery. */
export function readDeliveryFacts(path: string): DeliveryFacts {
  try {
    return DeliveryFacts.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { lastDeliveryAt: null };
  }
}

/**
 * Record that a delivery just happened, atomically.
 *
 * Called when the factory opens a delivery pull request, so the record is
 * written only for a pull request that really opened.
 */
export function recordDelivery(path: string, at: Date): DeliveryFacts {
  const facts: DeliveryFacts = { lastDeliveryAt: at.toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(facts, null, 2)}\n`);
  renameSync(temporary, path);
  return facts;
}

/**
 * The number of factory pull requests whose delivery has failed.
 *
 * The ledger holds the heads escalated to a human after the factory's repair
 * rounds are spent; a merged pull request clears its head, so the count is
 * the number of deliveries failing right now.
 */
export function deliveryFailedCount(logsDir: string): number {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(logsDir, "ci-alerts.json"), "utf8"));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The delivery-stall decision: the condition the Grafana alert fires on.
 *
 * A failed delivery stalls at once. A delivery without a new one stalls after
 * the window, but only when a delivery is known: a factory that has never
 * delivered has no window to measure, and a factory that stopped running
 * reports itself through its own stale status file.
 */
export function deliveryStallState(
  now: Date,
  lastDeliveryAt: string | null,
  failedDeliveries: number,
  windowMinutes: number = DEFAULT_DELIVERY_STALL_MINUTES,
): DeliveryStallState {
  let lastDeliveryAgeSeconds: number | null = null;
  if (lastDeliveryAt !== null) {
    const parsed = Date.parse(lastDeliveryAt);
    if (!Number.isNaN(parsed))
      lastDeliveryAgeSeconds = Math.max(0, (now.getTime() - parsed) / 1000);
  }
  const deliveryFailed = failedDeliveries > 0;
  const noNewDelivery =
    lastDeliveryAgeSeconds !== null && lastDeliveryAgeSeconds > windowMinutes * 60;
  return {
    stalled: deliveryFailed || noNewDelivery,
    deliveryFailed,
    noNewDelivery,
    lastDeliveryAgeSeconds,
    windowMinutes,
  };
}
