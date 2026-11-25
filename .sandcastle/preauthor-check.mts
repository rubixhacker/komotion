import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The advisory a pass hands to an author before it starts work on a ticket.
 *
 * A ticket whose repair reached round 2/3 once can lose a whole pass to the
 * same finding again: the resume brief carries the last verdict, but not the
 * fact that an earlier pass already spent a late repair round on that source.
 * This check reads the phase journal, names any late round that recurred in a
 * different pass, and points the author at the kept findings when they belong
 * to the same check. It never blocks a run: some late rounds were host faults
 * or ownership failures, and a source diagnostic is required to spend a strike.
 */

const PhaseLine = z.object({
  at: z.string(),
  passId: z.string(),
  phase: z.string(),
  ticket: z.number().int().nullable().default(null),
  detail: z.string().default(""),
});

const REPAIR_ROUND = /repairing\s+(.+?)\s+findings\s+\(round\s+(\d+)\s*\/\s*(\d+)\)/iu;

export interface PreauthorAdvisoryInput {
  /** Parsed lines from `.sandcastle/logs/factory-phases.jsonl`. */
  readonly phaseLines: readonly unknown[];
  readonly issue: number;
  /** Path of the kept findings file, relative to the factory root. */
  readonly findingsFile: string;
  /** Which check wrote the kept findings, when there are any for this head. */
  readonly findingsSource: string | null;
}

interface LateRepair {
  readonly source: string;
  readonly round: number;
  readonly total: number;
  readonly passes: Set<string>;
}

/** Read a JSONL journal, tolerating a partial final line from a killed writer. */
export function readPhaseLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const lines: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // An earlier complete line still describes a real repair round.
    }
  }
  return lines;
}

/**
 * An advisory naming late repair rounds that recurred across passes for this
 * ticket, or an empty string when no late round repeated.
 */
export function preauthorAdvisory(input: PreauthorAdvisoryInput): string {
  const late = new Map<string, LateRepair>();
  for (const candidate of input.phaseLines) {
    const parsed = PhaseLine.safeParse(candidate);
    if (!parsed.success || parsed.data.ticket !== input.issue) continue;
    const match = REPAIR_ROUND.exec(parsed.data.detail);
    const source = match?.[1]?.trim();
    const round = Number(match?.[2]);
    const total = Number(match?.[3]);
    if (source === undefined || source === "" || !Number.isInteger(round) || round < 2) continue;
    if (!Number.isInteger(total)) continue;
    const key = `${source.toLowerCase()}|${round}`;
    const previous = late.get(key);
    if (previous === undefined) {
      late.set(key, { source, round, total, passes: new Set([parsed.data.passId]) });
    } else {
      previous.passes.add(parsed.data.passId);
    }
  }
  const repeated = [...late.values()]
    .filter((repair) => repair.passes.size >= 2)
    .sort((a, b) => b.round - a.round || a.source.localeCompare(b.source));
  if (repeated.length === 0) return "";

  const rounds = repeated
    .map((repair) => `${repair.source} round ${repair.round}/${repair.total}`)
    .join(" and ");
  const lines = [
    `Pre-author advisory: earlier passes of this ticket repeated the ${rounds} repair.`,
  ];
  const matching = repeated.find(
    (repair) => repair.source.toLowerCase() === input.findingsSource?.toLowerCase(),
  );
  if (matching === undefined) {
    lines.push(
      "Find the finding behind that round in the prior verdicts and fix its cause before editing; another identical repair round will not deliver this ticket.",
    );
  } else {
    lines.push(
      `The last run's unresolved ${matching.source} findings are in ${input.findingsFile}; read them first and fix their cause before another repair round.`,
    );
  }
  return lines.join(" ");
}
