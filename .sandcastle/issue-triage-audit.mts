import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TriageCorrection } from "./issue-triage-feedback.mjs";
import type { IssueVerdict, StateLabel } from "./issue-triage-policy.mjs";

export interface IssueTriagePassAuditEntry {
  type: "issue_triage_pass";
  status: "success" | "failure";
  durationMs: number;
  issuesProcessed: number;
  applied: number;
  localDecisions: number;
  indeterminate: number;
  feedbackApplied: number;
  details?: string;
}

/**
 * The verdict the lane intended, kept separate from `issue_apply` so the log
 * never claims a GitHub write that did not happen. `error` marks a SubQ transport
 * failure rather than a model verdict.
 */
export interface IssueVerdictAuditEntry {
  type: "issue_verdict";
  issueNumber: number;
  classification: string;
  probability: number;
  noul: number;
  decision: IssueVerdict;
  applied: StateLabel | "unchanged" | "not_applied";
  indeterminate: boolean;
  reason: string;
  reviewer: string;
  error?: string;
  subqResponse: unknown;
  confirmationResponse?: unknown;
}

export interface IssueLocalDecisionAuditEntry {
  type: "issue_local_decision";
  issueNumber: number;
  rule: string;
  verdict: IssueVerdict;
  reason: string;
}

export interface IssueApplyAuditEntry {
  type: "issue_apply";
  issueNumber: number;
  verdict: StateLabel;
  previousLabel: string | undefined;
  status: "commented_and_labelled" | "comment_failed" | "label_failed";
  error?: string;
}

export interface IssueFeedbackAuditEntry {
  type: "issue_feedback";
  correction: TriageCorrection;
  status: "applied" | "rejected";
  reason?: string;
}

export type IssueTriageAuditEntry =
  | IssueTriagePassAuditEntry
  | IssueVerdictAuditEntry
  | IssueLocalDecisionAuditEntry
  | IssueApplyAuditEntry
  | IssueFeedbackAuditEntry;

/** Append one self-contained JSON object with an ISO-8601 timestamp. */
export function appendIssueTriageAudit(logPath: string, entry: IssueTriageAuditEntry): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`);
}

/**
 * Record the GitHub label change caused by an accepted feedback correction. This
 * stays a separate `issue_apply` row, matching the `issue_verdict` / `issue_apply`
 * split for ordinary verdicts, so the log never claims a write that did not happen.
 */
export function appendFeedbackApplyAudit(
  logPath: string,
  correction: TriageCorrection,
  previousLabel: string | undefined,
  status: IssueApplyAuditEntry["status"] = "commented_and_labelled",
  error?: string,
): void {
  appendIssueTriageAudit(logPath, {
    type: "issue_apply",
    issueNumber: correction.issueNumber,
    verdict: correction.verdict,
    previousLabel,
    status,
    ...(error ? { error } : {}),
  });
}

/** Read a JSONL audit log, ignoring a truncated final line from an interrupted write. */
export function readIssueTriageAudit(logPath: string): IssueTriageAuditEntry[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  const entries: IssueTriageAuditEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as IssueTriageAuditEntry);
    } catch {
      // Ignore a partial line.
    }
  }
  return entries;
}
