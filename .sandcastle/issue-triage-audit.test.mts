import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendFeedbackApplyAudit,
  type IssueApplyAuditEntry,
  readIssueTriageAudit,
} from "./issue-triage-audit.mjs";

const correction = {
  issueNumber: 1747,
  commentId: "c1",
  author: "owner",
  createdAt: "2026-11-23T00:00:00Z",
  verdict: "blocked" as const,
  previousVerdict: "ready-for-human" as const,
  reason: "owner correction",
};

function withAuditLog(check: (logPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "issue-triage-audit-"));
  try {
    check(join(directory, "audit.jsonl"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function onlyApplyEntry(logPath: string): IssueApplyAuditEntry {
  const entries = readIssueTriageAudit(logPath);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.type, "issue_apply");
  return entry as IssueApplyAuditEntry;
}

test("a feedback correction records its label change as a separate issue_apply row", () => {
  withAuditLog((logPath) => {
    appendFeedbackApplyAudit(logPath, correction, correction.previousVerdict);
    const entry = onlyApplyEntry(logPath);
    assert.equal(entry.issueNumber, 1747);
    assert.equal(entry.verdict, "blocked");
    assert.equal(entry.previousLabel, "ready-for-human");
    assert.equal(entry.status, "commented_and_labelled");
    assert.equal(entry.error, undefined);
  });
});

test("a failed feedback apply records the failing step and its error", () => {
  withAuditLog((logPath) => {
    appendFeedbackApplyAudit(logPath, correction, correction.previousVerdict, "label_failed", "gh failed");
    const entry = onlyApplyEntry(logPath);
    assert.equal(entry.status, "label_failed");
    assert.equal(entry.error, "gh failed");
  });
});
