import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { IssueTriageAuditEntry, IssueVerdictAuditEntry } from "./issue-triage-audit.mjs";
import type { TriageCorrection } from "./issue-triage-feedback.mjs";
import {
  readIssueTriageSummary,
  renderIssueTriageSummary,
  summarizeIssueTriage,
  type SummaryLogPaths,
} from "./issue-triage-summary.mjs";

function verdict(
  issueNumber: number,
  decision: IssueVerdictAuditEntry["decision"],
  noul: number,
  probability = 0.98,
): IssueVerdictAuditEntry {
  return {
    type: "issue_verdict",
    issueNumber,
    classification: "ready-for-human",
    probability,
    noul,
    decision,
    applied: "ready-for-human",
    indeterminate: false,
    reason: "model reason",
    reviewer: "SubQ",
    subqResponse: null,
  };
}

function correction(
  issueNumber: number,
  reason: string,
  previousVerdict: TriageCorrection["previousVerdict"] = undefined,
  verdictRole: TriageCorrection["verdict"] = "blocked",
): TriageCorrection {
  return {
    issueNumber,
    commentId: `comment-${issueNumber}`,
    author: "owner",
    createdAt: "2026-11-23T10:52:00Z",
    verdict: verdictRole,
    previousVerdict,
    reason,
  };
}

function withLogs(
  audit: string | undefined,
  feedback: string | undefined,
  check: (paths: SummaryLogPaths) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "issue-triage-summary-"));
  try {
    const paths = {
      auditPath: join(directory, "audit.jsonl"),
      feedbackPath: join(directory, "feedback.jsonl"),
    };
    if (audit !== undefined) writeFileSync(paths.auditPath, audit);
    if (feedback !== undefined) writeFileSync(paths.feedbackPath, feedback);
    check(paths);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const ownerReason =
  "next action needs the owner Tailscale login on Bazzite, an external dependency the lane cannot express as a GitHub edge";

test("verdict counts come from issue_verdict rows and match the tuning review", () => {
  const entries: IssueTriageAuditEntry[] = [
    verdict(1747, "ready-for-human", 0.97),
    verdict(1747, "ready-for-human", 0.97),
    verdict(2773, "ready-for-agent", 0.0, 0.99),
  ];
  const feedback = [correction(1747, ownerReason, "ready-for-human"), correction(2775, "verification")];
  const summary = summarizeIssueTriage(entries, feedback);

  assert.deepEqual(
    summary.verdictCounts.map((count) => [count.role, count.issues, count.rows]),
    [
      ["ready-for-agent", 1, 1],
      ["ready-for-human", 1, 2],
      ["blocked", 0, 0],
      ["wontfix", 0, 0],
      ["needs-info", 0, 0],
    ],
  );
  assert.deepEqual(summary.verdictIssues, [1747, 2773]);
  assert.deepEqual(summary.feedbackOnlyIssues, [2775]);
  assert.equal(summary.verdictRows[0]?.noul, 0.97);
  assert.equal(summary.verdictRows[2]?.noul, 0.0);

  const text = renderIssueTriageSummary(summary);
  assert.ok(text.includes("  ready-for-human: 1 issue (2 verdict rows)"), text);
  assert.ok(text.includes("  ready-for-agent: 1 issue (1 verdict row)"), text);
  assert.ok(text.includes("  unclear: 0 issues (0 verdict rows; indeterminate, not a state role)"), text);
  assert.ok(text.includes("Issues with verdict rows: #1747, #2773"), text);
  assert.ok(text.includes("Feedback-only records (no verdict row): #2775"), text);
  assert.ok(text.includes(`"${ownerReason}"`), text);
});

test("a feedback-only label change is not counted as a model verdict or given a noul", () => {
  const entries: IssueTriageAuditEntry[] = [
    { type: "issue_triage_pass", status: "success", durationMs: 10, issuesProcessed: 1, applied: 0, localDecisions: 0, indeterminate: 0, feedbackApplied: 1 },
    {
      type: "issue_apply",
      issueNumber: 2775,
      verdict: "ready-for-agent",
      previousLabel: "needs-triage",
      status: "commented_and_labelled",
    },
  ];
  const feedback = [
    correction(2775, "verification of the owner feedback correction loop after the audit fix in PR 2774", undefined, "ready-for-agent"),
  ];
  const summary = summarizeIssueTriage(entries, feedback);

  assert.ok(summary.verdictCounts.every((count) => count.issues === 0 && count.rows === 0));
  assert.deepEqual(summary.verdictIssues, []);
  assert.deepEqual(summary.feedbackOnlyIssues, [2775]);
  assert.deepEqual(summary.verdictRows, []);
  const text = renderIssueTriageSummary(summary);
  assert.ok(text.includes("Feedback-only records (no verdict row): #2775"), text);
  assert.ok(text.includes("noul=") === false, text);
});

test("a missing audit and feedback log yields an empty summary", () => {
  withLogs(undefined, undefined, (paths) => {
    const summary = readIssueTriageSummary(paths.auditPath, paths.feedbackPath);
    assert.ok(summary.verdictCounts.every((count) => count.issues === 0));
    assert.deepEqual(summary.verdictIssues, []);
    assert.deepEqual(summary.feedbackOnlyIssues, []);
    assert.deepEqual(summary.corrections, []);
    assert.ok(renderIssueTriageSummary(summary).includes("  (none)"));
  });
});

test("a truncated final line in either log is ignored", () => {
  const completeVerdict = JSON.stringify(verdict(2773, "ready-for-agent", 0.0, 0.99));
  const completeCorrection = JSON.stringify(correction(1747, ownerReason, "ready-for-human"));
  withLogs(
    `${completeVerdict}\n{"type":"issue_verdict","issueNumber":999,"decision":`,
    `${completeCorrection}\n{"issueNumber":888,"verdict":"blocked"`,
    (paths) => {
      const summary = readIssueTriageSummary(paths.auditPath, paths.feedbackPath);
      assert.deepEqual(summary.verdictIssues, [2773]);
      assert.deepEqual(summary.corrections.map((entry) => entry.issueNumber), [1747]);
      assert.deepEqual(summary.feedbackOnlyIssues, [1747]);
      assert.ok(renderIssueTriageSummary(summary).includes(`"${ownerReason}"`));
    },
  );
});

test("a verdict row without a state role is reported but not counted", () => {
  const summary = summarizeIssueTriage(
    [
      {
        ...verdict(1747, "unchanged", 0),
        error: "SubQ transport failed",
      },
      verdict(2773, "unclear", 0.5),
    ],
    [],
  );
  assert.equal(summary.noVerdictRows, 1);
  assert.equal(summary.unclearRows, 1);
  assert.deepEqual(summary.unclearIssues, [2773]);
  assert.deepEqual(summary.verdictRows, []);
  assert.ok(summary.verdictCounts.every((count) => count.issues === 0));
  const text = renderIssueTriageSummary(summary);
  assert.ok(text.includes("  unclear: 1 issue (1 verdict row; indeterminate, not a state role)"), text);
  assert.ok(text.includes("issue_verdict rows with no decision (transport failure), not counted above: 1"), text);
});
