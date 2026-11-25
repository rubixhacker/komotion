import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostCommand } from "./issue-triage-github.mjs";
import { retroIssue } from "./retro-body.mjs";
import { runRetro } from "./retro.mjs";
import { selectRetroEvidence, type RetroEvidence } from "./retro-evidence.mjs";
import { readRetroState, retroStatePath } from "./retro-state.mjs";

const AT = "2026-11-23T10:00:00.000Z";

function evidenceFor(passId = "p1", detail = "repair round 1/3"): RetroEvidence {
  return selectRetroEvidence({
    status: null,
    completions: [{ passId, finishedAt: AT, phase: "finished", delivered: 1, error: null }],
    phaseLines: [{ at: AT, passId, phase: "authoring", ticket: 42, detail }],
    ledger: {},
    findings: [{ issue: 42, source: "review" }],
    deliveredIssues: [42],
    reconciliationLines: [],
  });
}

interface Call {
  readonly program: string;
  readonly args: readonly string[];
  readonly body: string;
}

function recordingRun(calls: Call[], openTitles: readonly string[] = []): HostCommand {
  return (program, args) => {
    if (program === "gh" && args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(
        openTitles.map((title, index) => ({
          number: 9000 + index,
          title,
          body: "",
          labels: [{ name: "needs-triage" }],
        })),
      );
    }
    const flag = args.indexOf("--body-file");
    const path = flag < 0 ? undefined : args[flag + 1];
    calls.push({
      program,
      args,
      body: path === undefined ? "" : readFileSync(path, "utf8"),
    });
    return "https://github.com/rubixhacker/komotion/issues/9999\n";
  };
}

function scratch(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retro-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the retro opens one needs-triage issue with the selected evidence", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const result = runRetro({ root, run: recordingRun(calls), evidence: evidenceFor() });
    assert.equal(result.created, true);
    assert.match(result.url ?? "", /issues\/9999/u);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.program, "gh");
    assert.deepEqual(calls[0]?.args.slice(0, 3), ["issue", "create", "--repo"]);
    assert.ok(calls[0]?.args.includes("needs-triage"));
    assert.ok(calls[0]?.body.includes("## Evidence"));
    assert.ok(calls[0]?.body.includes("Repair rounds: 1 repair round(s) recorded."));
    assert.equal(readRetroState(retroStatePath(root)).lastPassId, "p1");
  });
});

test("a retry of the same evidence does not open a second issue", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const run = recordingRun(calls);
    assert.equal(runRetro({ root, run, evidence: evidenceFor() }).created, true);
    const second = runRetro({ root, run, evidence: evidenceFor() });
    assert.equal(second.created, false);
    assert.equal(second.reason, "proposal unchanged");
    assert.equal(calls.length, 1);
  });
});

test("an already filed proposal blocks a new issue in every issue state", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const commands: string[][] = [];
    const existingTitle = retroIssue(evidenceFor()).title;
    const run = recordingRun(calls, [existingTitle]);
    const result = runRetro({
      root,
      run: (program, args) => {
        commands.push([...args]);
        return run(program, args);
      },
      evidence: evidenceFor(),
    });
    assert.equal(result.created, false);
    assert.equal(result.reason, "issue with the same proposal");
    assert.match(result.url ?? "", /issues\/9000/u);
    assert.equal(calls.length, 0);
    assert.equal(readRetroState(retroStatePath(root)).issueUrl, result.url);
    assert.ok(
      commands.some(
        (args) =>
          args.includes("list") &&
          args.includes("all") &&
          args.includes("number,title"),
      ),
      "the retro must look past open issues when it checks for a duplicate",
    );
  });
});

test("a later pass that repeats the same proposal does not open a second issue", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const run = recordingRun(calls);
    const detail = "repairing review findings (round 2/3)";
    const completion = (passId: string) => ({
      passId,
      finishedAt: AT,
      phase: "finished" as const,
      delivered: 0,
      error: null,
    });
    const phaseLine = (passId: string) => ({
      at: AT,
      passId,
      phase: "authoring" as const,
      ticket: 42,
      detail,
    });
    runRetro({
      root,
      run,
      evidence: selectRetroEvidence({
        status: null,
        completions: [completion("p1")],
        phaseLines: [phaseLine("p1")],
        ledger: {},
        findings: [{ issue: 42, source: "review" }],
        deliveredIssues: [],
        reconciliationLines: [],
      }),
    });
    const second = runRetro({
      root,
      run,
      evidence: selectRetroEvidence({
        status: null,
        completions: [completion("p1"), completion("p2")],
        phaseLines: [phaseLine("p1"), phaseLine("p2")],
        ledger: {},
        findings: [{ issue: 42, source: "review" }],
        deliveredIssues: [],
        reconciliationLines: [],
      }),
    });
    assert.equal(second.created, false);
    assert.equal(second.reason, "proposal unchanged");
    assert.equal(calls.length, 1);
  });
});

test("a later pass with a different proposal opens a new issue", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const run = recordingRun(calls);
    runRetro({ root, run, evidence: evidenceFor("p1") });
    const second = runRetro({
      root,
      run,
      evidence: selectRetroEvidence({
        status: null,
        completions: [
          { passId: "p2", finishedAt: AT, phase: "finished", delivered: 0, error: null },
        ],
        phaseLines: [],
        ledger: {},
        findings: [{ issue: 42, source: "review" }],
        deliveredIssues: [],
        reconciliationLines: [],
      }),
    });
    assert.equal(second.created, true);
    assert.equal(calls.length, 2);
    assert.equal(readRetroState(retroStatePath(root)).lastPassId, "p2");
  });
});

test("an idle pass with no evidence opens nothing", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const evidence = selectRetroEvidence({
      status: null,
      completions: [{ passId: "p1", finishedAt: AT, phase: "finished", delivered: 0, error: null }],
      phaseLines: [],
      ledger: {},
      findings: [],
      deliveredIssues: [],
      reconciliationLines: [],
    });
    const result = runRetro({ root, run: recordingRun(calls), evidence });
    assert.equal(result.created, false);
    assert.equal(result.reason, "no substantive evidence");
    assert.equal(calls.length, 0);
  });
});

test("no completed pass means no issue and no GitHub call", () => {
  scratch((root) => {
    const calls: Call[] = [];
    const evidence = selectRetroEvidence({
      status: null,
      completions: [],
      phaseLines: [],
      ledger: {},
      findings: [],
      deliveredIssues: [],
      reconciliationLines: [],
    });
    const result = runRetro({ root, run: recordingRun(calls), evidence });
    assert.equal(result.created, false);
    assert.equal(result.reason, "no completed passes");
    assert.equal(calls.length, 0);
  });
});
