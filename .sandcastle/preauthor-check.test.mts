import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { preauthorAdvisory, readPhaseLines } from "./preauthor-check.mjs";

const AT = "2026-11-23T10:00:00.000Z";
const FINDINGS = ".sandcastle/patches/sandcastle-issue-42/unresolved-findings.md";

function phase(passId: string, detail: string, ticket = 42): unknown {
  return { at: AT, passId, phase: "authoring", ticket, detail };
}

function advisory(
  phaseLines: readonly unknown[],
  findingsSource: string | null = null,
): string {
  return preauthorAdvisory({
    phaseLines,
    issue: 42,
    findingsFile: FINDINGS,
    findingsSource,
  });
}

test("a first late repair round produces no advisory", () => {
  assert.equal(advisory([phase("p1", "repairing review findings (round 2/3)")]), "");
  assert.equal(advisory([phase("p1", "repairing review findings (round 1/3)")]), "");
});

test("the same late round in two passes produces an advisory", () => {
  const text = advisory([
    phase("p1", "repairing review findings (round 2/3)"),
    phase("p2", "repairing review findings (round 2/3)"),
  ]);
  assert.match(text, /repeated the review round 2\/3 repair/u);
  assert.match(text, /another identical repair round will not deliver this ticket/u);
});

test("repeated rounds from another ticket are ignored", () => {
  assert.equal(
    advisory([
      phase("p1", "repairing Swift compile findings (round 2/3)", 41),
      phase("p2", "repairing Swift compile findings (round 2/3)", 43),
    ]),
    "",
  );
});

test("a repeated Swift compile round names that source", () => {
  const text = advisory([
    phase("p1", "repairing Swift compile findings (round 2/3)"),
    phase("p2", "repairing Swift compile findings (round 2/3)"),
  ]);
  assert.match(text, /repeated the Swift compile round 2\/3 repair/u);
  assert.doesNotMatch(text, /review round/u);
});

test("two late rounds in one pass are not a repeat", () => {
  assert.equal(
    advisory([
      phase("p1", "repairing Swift lint findings (round 1/3)"),
      phase("p1", "repairing Swift lint findings (round 2/3)"),
    ]),
    "",
  );
});

test("kept findings from the repeated check are named", () => {
  const text = advisory(
    [
      phase("p1", "repairing Swift compile findings (round 2/3)"),
      phase("p2", "repairing Swift compile findings (round 2/3)"),
    ],
    "Swift compile",
  );
  assert.match(text, /unresolved Swift compile findings are in/u);
  assert.ok(text.includes(FINDINGS));
});

test("kept findings from another check do not claim to explain the repeat", () => {
  const text = advisory(
    [
      phase("p1", "repairing review findings (round 2/3)"),
      phase("p2", "repairing review findings (round 2/3)"),
    ],
    "Swift compile",
  );
  assert.doesNotMatch(text, /unresolved/u);
  assert.match(text, /fix its cause/u);
});

test("more than one repeated source is reported", () => {
  const text = advisory([
    phase("p1", "repairing review findings (round 2/3)"),
    phase("p2", "repairing review findings (round 2/3)"),
    phase("p3", "repairing gate findings (round 3/3)"),
    phase("p4", "repairing gate findings (round 3/3)"),
  ]);
  assert.match(text, /gate round 3\/3 and review round 2\/3 repair/u);
});

test("malformed phase lines are ignored", () => {
  assert.equal(
    advisory(["not json", { at: AT, passId: "p1", ticket: "42", detail: "repair round 2/3" }]),
    "",
  );
});

test("reading a phase journal tolerates a partial final line", () => {
  const directory = mkdtempSync(join(tmpdir(), "preauthor-"));
  try {
    const path = join(directory, "factory-phases.jsonl");
    writeFileSync(path, `${JSON.stringify(phase("p1", "repair round 2/3"))}\n{"at":`);
    assert.equal(readPhaseLines(path).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing phase journal reads as empty", () => {
  assert.deepEqual(readPhaseLines(join(tmpdir(), "no-such-phases.jsonl")), []);
});
