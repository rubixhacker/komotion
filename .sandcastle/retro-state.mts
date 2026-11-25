import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { proposeImprovement } from "./retro-body.mjs";
import type { RetroEvidence } from "./retro-evidence.mjs";

/**
 * The last proposal the retro reported, so a second consumer invoked after the
 * same pass does not open a second issue. The fingerprint is content-based: a
 * later pass with a different proposal produces a new issue, while a pass that
 * only adds another record of the same finding stays idempotent.
 */
export const RetroState = z.object({
  lastPassId: z.string().nullable(),
  fingerprint: z.string(),
  issueUrl: z.string().nullable(),
});
export type RetroState = z.infer<typeof RetroState>;

const EMPTY_STATE: RetroState = { lastPassId: null, fingerprint: "", issueUrl: null };

export function retroStatePath(root: string): string {
  return `${root}/.sandcastle/logs/retro-state.json`;
}

export function proposalFingerprint(evidence: RetroEvidence): string {
  return createHash("sha256").update(proposeImprovement(evidence)).digest("hex");
}

export function readRetroState(path: string): RetroState {
  if (!existsSync(path)) return EMPTY_STATE;
  try {
    const parsed = RetroState.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function writeRetroState(path: string, state: RetroState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
