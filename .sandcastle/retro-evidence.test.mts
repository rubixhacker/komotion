import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRetroEvidence, selectRetroEvidence } from "./retro-evidence.mjs";

const AT = "2026-11-23T10:00:00.000Z";

function scratch(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retro-evidence-"));
  mkdirSync(join(root, ".sandcastle", "logs"), { recursive: true });
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function input() {
  return {
    status: null,
    completions: [
      { passId: "p1", finishedAt: AT, phase: "finished" as const, delivered: 1, error: null },
      { passId: "p2", finishedAt: AT, phase: "failed" as const, delivered: 0, error: "boom" },
    ],
    phaseLines: [
      { at: AT, passId: "p2", phase: "authoring", ticket: 42, detail: "repairing Swift lint (round 1/3)" },
      { at: AT, passId: "p2", phase: "authoring", ticket: 42, detail: "round 2/3" },
      { at: AT, passId: "p2", phase: "reviewing", ticket: 43, detail: "independent review" },
      { malformed: true },
    ],
    ledger: {
      "42": {
        strikes: [
          { at: AT, kind: "review-failed" as const, detail: "raw spacing literal" },
          { at: AT, kind: "declined" as const, detail: "not selected" },
        ],
      },
      "44": { strikes: [{ at: AT, kind: "gate-failed" as const, detail: "lint" }] },
    },
    findings: [
      { issue: 43, source: "gate" },
      { issue: 42, source: "review" },
      { issue: 99, source: "" },
    ],
    deliveredIssues: [44, 45, 44],
    reconciliationLines: [
      { at: AT, event: "merged-pr-reconciliation", issue: 45, reason: "branch moved" },
      { at: AT, event: "sweep" },
    ],
  };
}

test("selection keeps pass outcomes, repair rounds and kept findings", () => {
  const evidence = selectRetroEvidence(input());
  assert.deepEqual(
    evidence.passes.map((pass) => [pass.passId, pass.phase, pass.delivered]),
    [
      ["p1", "finished", 1],
      ["p2", "failed", 0],
    ],
  );
  assert.equal(evidence.passes[1]?.error, "boom");
  assert.deepEqual(
    evidence.repairRounds.map((round) => round.detail),
    ["repairing Swift lint (round 1/3)", "round 2/3"],
  );
  assert.deepEqual(evidence.repairRounds[0]?.issue, 42);
  assert.deepEqual(
    evidence.reviewFindings.map((finding) => [finding.issue, finding.source]),
    [
      [42, "review"],
      [43, "gate"],
    ],
  );
  assert.equal(evidence.status, null);
});

test("selection merges delivery outcomes and drops non-failure strikes", () => {
  const evidence = selectRetroEvidence(input());
  const kinds = evidence.deliveryOutcomes.map((outcome) => [outcome.issue, outcome.kind]);
  assert.deepEqual(kinds, [
    [42, "review-failed"],
    [44, "delivered"],
    [44, "gate-failed"],
    [45, "delivered"],
    [45, "reconciliation:merged-pr-reconciliation"],
  ]);
});

test("selection is bounded so a noisy journal cannot bloat the issue", () => {
  const base = input();
  const evidence = selectRetroEvidence({
    ...base,
    completions: Array.from({ length: 40 }, (_, index) => ({
      passId: `p${index}`,
      finishedAt: `2026-11-23T10:${String(index).padStart(2, "0")}:00.000Z`,
      phase: "finished" as const,
      delivered: 0,
      error: null,
    })),
  });
  assert.equal(evidence.passes.length, 20);
  assert.equal(evidence.passes[0]?.passId, "p20");
});

test("reading a checkout gathers every finished-session source", () => {
  scratch((root) => {
    const logs = join(root, ".sandcastle", "logs");
    writeFileSync(
      join(logs, "status.json"),
      JSON.stringify({
        passId: "p1",
        phase: "finished",
        ticket: null,
        detail: "",
        startedAt: AT,
        updatedAt: AT,
        finishedAt: AT,
        error: null,
        tickets: {},
        delivered: 1,
      }),
    );
    writeFileSync(
      join(logs, "pass-completions.jsonl"),
      `${JSON.stringify({ passId: "p1", finishedAt: AT, phase: "finished", delivered: 1, error: null })}\n`,
    );
    writeFileSync(
      join(logs, "factory-phases.jsonl"),
      `${JSON.stringify({ at: AT, passId: "p1", phase: "authoring", ticket: 42, detail: "repair round 1/3" })}\n`,
    );
    writeFileSync(
      join(logs, "ticket-ledger.json"),
      JSON.stringify({ "42": { strikes: [{ at: AT, kind: "review-failed", detail: "finding" }] } }),
    );
    writeFileSync(
      join(logs, "merge-reconciliation.jsonl"),
      `${JSON.stringify({ at: AT, event: "merged-pr-reconciliation", issue: 42, reason: "merged" })}\n`,
    );
    writeFileSync(join(logs, "pr-42.md"), "Closes #42.\n");
    const patch = join(root, ".sandcastle", "patches", "sandcastle-issue-43");
    mkdirSync(patch, { recursive: true });
    writeFileSync(
      join(patch, "unresolved-findings.md"),
      "<!-- findings for abc1234 from review -->\n\n1. A finding.\n",
    );

    const evidence = readRetroEvidence(root);
    assert.equal(evidence.status?.passId, "p1");
    assert.equal(evidence.passes.length, 1);
    assert.equal(evidence.repairRounds.length, 1);
    assert.deepEqual(evidence.reviewFindings, [{ issue: 43, source: "review" }]);
    assert.ok(evidence.deliveryOutcomes.some((outcome) => outcome.kind === "delivered"));
    assert.ok(evidence.deliveryOutcomes.some((outcome) => outcome.kind === "review-failed"));
  });
});
