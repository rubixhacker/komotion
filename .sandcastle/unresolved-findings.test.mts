import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findingsFor,
  findingsNote,
  findingsPath,
  readFindings,
  saveFindings,
} from "./unresolved-findings.mjs";

const HEAD = "ff9dfb2a4c1e0b7d6f5a4c3b2a1908f7e6d5c4b3";

function scratch(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "unresolved-findings-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("kept findings name their commit and check, and keep the reviewer's text", () => {
  scratch((dir) => {
    const file = join(dir, "nested", "unresolved-findings.md");
    saveFindings(file, { head: HEAD, source: "review" }, "\n1. A raw spacing literal.\n\n");
    assert.deepEqual(readFindings(file), { head: HEAD, source: "review" });
    assert.match(readFileSync(file, "utf8"), /\n\n1\. A raw spacing literal\.\n$/);
  });
});

test("a check named with two words is read back whole", () => {
  scratch((dir) => {
    const file = join(dir, "unresolved-findings.md");
    saveFindings(file, { head: HEAD, source: "Swift compile" }, "error: no such module");
    assert.equal(readFindings(file)?.source, "Swift compile");
  });
});

test("findings apply only to a resume of the commit they are about", () => {
  scratch((dir) => {
    const file = join(dir, "unresolved-findings.md");
    saveFindings(file, { head: HEAD, source: "gate" }, "detekt failed");
    assert.deepEqual(findingsFor(file, HEAD), { head: HEAD, source: "gate" });
    assert.equal(findingsFor(file, "0000000000000000000000000000000000000000"), null);
    // A first attempt has no commit to resume.
    assert.equal(findingsFor(file, null), null);
  });
});

test("a missing file or one without the header holds no findings", () => {
  scratch((dir) => {
    assert.equal(readFindings(join(dir, "absent.md")), null);
    const file = join(dir, "unresolved-findings.md");
    writeFileSync(file, "1. Something a person wrote here.\n");
    assert.equal(readFindings(file), null);
  });
});

test("the resuming author is told where the findings are and which check raised them", () => {
  assert.equal(
    findingsPath(41),
    ".sandcastle/patches/sandcastle-issue-41/unresolved-findings.md",
  );
  const note = findingsNote(findingsPath(41), "review");
  assert.match(note, /^ The last run/);
  assert.match(note, /review findings/);
  assert.match(note, /sandcastle-issue-41\/unresolved-findings\.md/);
});
