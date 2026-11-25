import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { FactoryStatus } from "./status.mjs";

/**
 * A durable record that a factory pass ended. The pass writes one line here as
 * it closes its status file; the post-pass retro reads the lines afterwards.
 *
 * Keeping the record in its own append-only file matters: `status.json` is
 * overwritten by the next pass, so an event written there would be lost before
 * the retro could read it. The retro never runs inside the pass that emits the
 * record.
 */
export const PassCompletion = z.object({
  passId: z.string().min(1),
  finishedAt: z.string().min(1),
  phase: z.enum(["finished", "failed"]),
  delivered: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type PassCompletion = z.infer<typeof PassCompletion>;

/** Where finished passes are recorded, relative to a factory checkout root. */
export function passCompletionsPath(root: string): string {
  return `${root}/.sandcastle/logs/pass-completions.jsonl`;
}

/** Append a pass's closing state. Safe to repeat for the same pass id: readers deduplicate. */
export function recordPassCompletion(path: string, status: FactoryStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const completion: PassCompletion = {
    passId: status.passId,
    finishedAt: status.finishedAt ?? status.updatedAt,
    phase: status.phase === "failed" ? "failed" : "finished",
    delivered: status.delivered,
    error: status.error,
  };
  appendFileSync(path, `${JSON.stringify(completion)}\n`);
}

/**
 * Every distinct completed pass, oldest first. A truncated or malformed line is
 * ignored rather than failing the retro: the file is written by an append that
 * a killed process can interrupt, and later lines still describe real passes.
 */
export function readPassCompletions(path: string): PassCompletion[] {
  if (!existsSync(path)) return [];
  const byId = new Map<string, PassCompletion>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = PassCompletion.safeParse(value);
    if (parsed.success && !byId.has(parsed.data.passId))
      byId.set(parsed.data.passId, parsed.data);
  }
  return [...byId.values()].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
}
