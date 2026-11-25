import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  type PassCompletion,
  passCompletionsPath,
  readPassCompletions,
} from "./pass-completions.mjs";
import { readFindings } from "./unresolved-findings.mjs";
import { type FactoryStatus, readStatus } from "./status.mjs";
import { TicketLedger } from "./ticket-ledger.mjs";

/**
 * What a retro is allowed to look at. Every source is a record a finished pass
 * left on disk; the retro never reads a live sandbox or edits one. Selection is
 * a pure function over these values so the choice of evidence is testable
 * without staging a real factory checkout.
 */

const MAX_PASSES = 20;
const MAX_REVIEW_FINDINGS = 20;
const MAX_REPAIR_ROUNDS = 30;
const MAX_DELIVERY_OUTCOMES = 30;

const PhaseLine = z.object({
  at: z.string(),
  passId: z.string(),
  phase: z.string(),
  ticket: z.number().int().nullable().default(null),
  detail: z.string().default(""),
});

const ReconciliationLine = z.object({
  at: z.string(),
  event: z.string(),
  issue: z.number().int().nullable().default(null),
  reason: z.string().nullable().optional(),
});

const FAILURE_STRIKES: ReadonlySet<string> = new Set([
  "review-failed",
  "gate-failed",
  "repair-failed",
  "error",
  "resume-exhausted",
]);

export interface KeptFinding {
  readonly issue: number;
  readonly source: string;
}

export interface PassEvidence {
  readonly passId: string;
  readonly finishedAt: string;
  readonly phase: "finished" | "failed";
  readonly delivered: number;
  readonly error: string | null;
}

export interface ReviewFindingEvidence {
  readonly issue: number;
  readonly source: string;
}

export interface RepairRoundEvidence {
  readonly at: string;
  readonly issue: number | null;
  readonly detail: string;
}

export interface DeliveryOutcomeEvidence {
  readonly issue: number;
  readonly kind: string;
  readonly detail: string;
}

export interface RetroEvidence {
  readonly status: FactoryStatus | null;
  readonly passes: readonly PassEvidence[];
  readonly reviewFindings: readonly ReviewFindingEvidence[];
  readonly repairRounds: readonly RepairRoundEvidence[];
  readonly deliveryOutcomes: readonly DeliveryOutcomeEvidence[];
}

export interface RetroEvidenceInput {
  readonly status: FactoryStatus | null;
  readonly completions: readonly PassCompletion[];
  readonly phaseLines: readonly unknown[];
  readonly ledger: TicketLedger;
  readonly findings: readonly KeptFinding[];
  readonly deliveredIssues: readonly number[];
  readonly reconciliationLines: readonly unknown[];
}

/** Select the bounded, deduplicated evidence a retro may quote in its issue. */
export function selectRetroEvidence(input: RetroEvidenceInput): RetroEvidence {
  const passes: PassEvidence[] = input.completions.slice(-MAX_PASSES).map((completion) => ({
    passId: completion.passId,
    finishedAt: completion.finishedAt,
    phase: completion.phase,
    delivered: completion.delivered,
    error: completion.error,
  }));

  const findings = [...input.findings]
    .filter((finding) => finding.source !== "")
    .sort((a, b) => a.issue - b.issue)
    .slice(0, MAX_REVIEW_FINDINGS)
    .map((finding) => ({ issue: finding.issue, source: finding.source }));

  const repairRounds: RepairRoundEvidence[] = [];
  for (const line of input.phaseLines) {
    const parsed = PhaseLine.safeParse(line);
    if (!parsed.success) continue;
    const { detail } = parsed.data;
    if (!/repair/i.test(detail) && !/round\s+\d+\/\d+/i.test(detail)) continue;
    repairRounds.push({
      at: parsed.data.at,
      issue: parsed.data.ticket,
      detail,
    });
  }

  const deliveryOutcomes: DeliveryOutcomeEvidence[] = [];
  for (const issue of [...new Set(input.deliveredIssues)].sort((a, b) => a - b)) {
    deliveryOutcomes.push({ issue, kind: "delivered", detail: "delivery written" });
  }
  for (const [number, entry] of Object.entries(input.ledger)) {
    const issue = Number(number);
    if (!Number.isInteger(issue)) continue;
    for (const strike of entry.strikes) {
      if (!FAILURE_STRIKES.has(strike.kind)) continue;
      deliveryOutcomes.push({ issue, kind: strike.kind, detail: strike.detail });
    }
  }
  for (const line of input.reconciliationLines.slice(-MAX_DELIVERY_OUTCOMES)) {
    const parsed = ReconciliationLine.safeParse(line);
    if (!parsed.success || parsed.data.issue === null) continue;
    deliveryOutcomes.push({
      issue: parsed.data.issue,
      kind: `reconciliation:${parsed.data.event}`,
      detail: parsed.data.reason ?? parsed.data.event,
    });
  }

  return {
    status: input.status,
    passes,
    reviewFindings: findings,
    repairRounds: repairRounds.slice(-MAX_REPAIR_ROUNDS),
    deliveryOutcomes: deliveryOutcomes
      .sort((a, b) => a.issue - b.issue || a.kind.localeCompare(b.kind))
      .slice(0, MAX_DELIVERY_OUTCOMES),
  };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const lines: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A killed writer can leave a partial final line; earlier lines stand.
    }
  }
  return lines;
}

function readLedger(path: string): TicketLedger {
  if (!existsSync(path)) return {};
  try {
    const parsed = TicketLedger.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function keptFindings(root: string): KeptFinding[] {
  const patches = join(root, ".sandcastle", "patches");
  if (!existsSync(patches)) return [];
  const result: KeptFinding[] = [];
  for (const name of readdirSync(patches)) {
    const match = /^sandcastle-issue-(\d+)$/.exec(name);
    if (match?.[1] === undefined) continue;
    const found = readFindings(join(patches, name, "unresolved-findings.md"));
    if (found === null) continue;
    result.push({ issue: Number(match[1]), source: found.source });
  }
  return result;
}

function deliveredIssues(root: string): number[] {
  const logs = join(root, ".sandcastle", "logs");
  if (!existsSync(logs)) return [];
  const result: number[] = [];
  for (const name of readdirSync(logs)) {
    const match = /^pr-(\d+)\.md$/.exec(name);
    if (match?.[1] !== undefined) result.push(Number(match[1]));
  }
  return result;
}

/** Read the finished-session evidence from a factory checkout. */
export function readRetroEvidence(root: string): RetroEvidence {
  const logs = join(root, ".sandcastle", "logs");
  let status: FactoryStatus | null = null;
  try {
    status = readStatus(join(logs, "status.json"));
  } catch {
    // A half-written status file must not stop the retro from reading the log.
  }
  return selectRetroEvidence({
    status,
    completions: readPassCompletions(passCompletionsPath(root)),
    phaseLines: readJsonl(join(logs, "factory-phases.jsonl")),
    ledger: readLedger(join(logs, "ticket-ledger.json")),
    findings: keptFindings(root),
    deliveredIssues: deliveredIssues(root),
    reconciliationLines: readJsonl(join(logs, "merge-reconciliation.jsonl")),
  });
}
