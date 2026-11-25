import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readIssueTriageAudit,
  type IssueTriageAuditEntry,
} from "./issue-triage-audit.mjs";
import { readFeedbackLog, type TriageCorrection } from "./issue-triage-feedback.mjs";
import { STATE_LABELS, isStateLabel, type StateLabel } from "./issue-triage-policy.mjs";

/**
 * A rendered model verdict from an `issue_verdict` audit row. `noul` and the
 * probability live on the same row as the verdict: a feedback record has no
 * SubQ answer, so it can never contribute either number.
 */
export interface VerdictRow {
  issueNumber: number;
  role: StateLabel;
  classification: string;
  probability: number;
  noul: number;
  applied: string;
  indeterminate: boolean;
}

export interface RoleVerdictCount {
  role: StateLabel;
  /** Distinct issues with a model verdict in this role, not the row count. */
  issues: number;
  issueNumbers: number[];
  rows: number;
}

export interface IssueTriageSummary {
  /** One entry per state role, in `STATE_LABELS` order, including zero counts. */
  verdictCounts: RoleVerdictCount[];
  verdictRows: VerdictRow[];
  /** Issues with at least one model verdict row. */
  verdictIssues: number[];
  /** Issues recorded in the feedback log with no model verdict row of their own. */
  feedbackOnlyIssues: number[];
  /** Every feedback record, in log order, with its reason kept verbatim. */
  corrections: TriageCorrection[];
  /** Indeterminate model results: `issue_verdict` rows whose decision is `unclear`. */
  unclearRows: number;
  unclearIssues: number[];
  /** `issue_verdict` rows with no decision at all (a SubQ transport failure). */
  noVerdictRows: number;
}

function sortedUnique(numbers: readonly number[]): number[] {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/**
 * Build the tuning-review summary from the two append-only logs. Only
 * `issue_verdict` rows whose `decision` is a state role are model verdicts;
 * a label changed by owner feedback is counted from the feedback log instead,
 * even when the audit also records the resulting `issue_apply` write.
 */
export function summarizeIssueTriage(
  entries: readonly IssueTriageAuditEntry[],
  corrections: readonly TriageCorrection[],
): IssueTriageSummary {
  const verdictRows: VerdictRow[] = [];
  const unclearIssues: number[] = [];
  let unclearRows = 0;
  let noVerdictRows = 0;
  for (const entry of entries) {
    if (entry.type !== "issue_verdict") continue;
    if (entry.decision === "unclear") {
      unclearRows += 1;
      unclearIssues.push(entry.issueNumber);
      continue;
    }
    if (!isStateLabel(entry.decision)) {
      noVerdictRows += 1;
      continue;
    }
    verdictRows.push({
      issueNumber: entry.issueNumber,
      role: entry.decision,
      classification: entry.classification,
      probability: entry.probability,
      noul: entry.noul,
      applied: entry.applied,
      indeterminate: entry.indeterminate,
    });
  }

  const verdictCounts = STATE_LABELS.map((role) => {
    const rows = verdictRows.filter((row) => row.role === role);
    const issueNumbers = sortedUnique(rows.map((row) => row.issueNumber));
    return { role, issues: issueNumbers.length, issueNumbers, rows: rows.length };
  });
  const verdictIssues = sortedUnique(verdictRows.map((row) => row.issueNumber));
  const withVerdict = new Set(verdictIssues);
  const feedbackOnlyIssues = sortedUnique(corrections.map((correction) => correction.issueNumber)).filter(
    (issueNumber) => !withVerdict.has(issueNumber),
  );

  return {
    verdictCounts,
    verdictRows,
    verdictIssues,
    feedbackOnlyIssues,
    corrections: [...corrections],
    unclearRows,
    unclearIssues: sortedUnique(unclearIssues),
    noVerdictRows,
  };
}

/** Read both logs. A missing or truncated file yields no entries, never a failed command. */
export function readIssueTriageSummary(auditPath: string, feedbackPath: string): IssueTriageSummary {
  let feedbackText = "";
  try {
    feedbackText = readFileSync(feedbackPath, "utf8");
  } catch {
    // A log that has not been written yet is the empty summary.
  }
  return summarizeIssueTriage(readIssueTriageAudit(auditPath), readFeedbackLog(feedbackText));
}

export interface SummaryLogPaths {
  auditPath: string;
  feedbackPath: string;
}

export function defaultSummaryLogPaths(): SummaryLogPaths {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const logs = resolve(root, ".sandcastle/logs");
  return {
    auditPath: resolve(logs, "issue-triage-audit.jsonl"),
    feedbackPath: resolve(logs, "issue-triage-feedback.jsonl"),
  };
}

export function renderIssueTriageSummary(
  summary: IssueTriageSummary,
  paths: SummaryLogPaths = defaultSummaryLogPaths(),
): string {
  const lines = [
    "Issue triage verdict summary",
    `Audit log: ${paths.auditPath}`,
    `Feedback log: ${paths.feedbackPath}`,
    "",
    "Verdicts by state role (issue_verdict rows only):",
    ...summary.verdictCounts.map(
      (count) =>
        `  ${count.role}: ${count.issues} issue${count.issues === 1 ? "" : "s"} (${count.rows} verdict row${count.rows === 1 ? "" : "s"})`,
    ),
    `  unclear: ${summary.unclearIssues.length} issue${summary.unclearIssues.length === 1 ? "" : "s"} (${summary.unclearRows} verdict row${summary.unclearRows === 1 ? "" : "s"}; indeterminate, not a state role)`,
    "",
    "Verdict rows (probability and noul belong to the same row as the verdict):",
    ...(summary.verdictRows.length > 0
      ? summary.verdictRows.map(
          (row) =>
            `  #${row.issueNumber}  ${row.role}  classification=${row.classification}  p=${row.probability.toFixed(2)}  noul=${row.noul.toFixed(2)}${row.indeterminate ? "  (indeterminate)" : ""}`,
        )
      : ["  (none)"]),
    `  issue_verdict rows with no decision (transport failure), not counted above: ${summary.noVerdictRows}`,
    "",
    `Issues with verdict rows: ${summary.verdictIssues.length > 0 ? summary.verdictIssues.map((number) => `#${number}`).join(", ") : "(none)"}`,
    `Feedback-only records (no verdict row): ${summary.feedbackOnlyIssues.length > 0 ? summary.feedbackOnlyIssues.map((number) => `#${number}`).join(", ") : "(none)"}`,
    "",
    "Corrections (verbatim reasons from the feedback log):",
    ...(summary.corrections.length > 0
      ? summary.corrections.map((correction) => {
          const from = correction.previousVerdict ?? "(no previous verdict)";
          return `  #${correction.issueNumber}  ${from} -> ${correction.verdict}  "${correction.reason}"`;
        })
      : ["  (none)"]),
  ];
  return `${lines.join("\n")}\n`;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a path`);
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const defaults = defaultSummaryLogPaths();
  const paths = {
    auditPath: option(args, "--audit") ?? defaults.auditPath,
    feedbackPath: option(args, "--feedback") ?? defaults.feedbackPath,
  };
  process.stdout.write(renderIssueTriageSummary(readIssueTriageSummary(paths.auditPath, paths.feedbackPath), paths));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
