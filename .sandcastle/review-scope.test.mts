import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewScope } from "./review-scope.mjs";

const HEAD = "86383bf4d7de9895f8b5834091526cffe891e035";

test("a ticket's branch is reviewed whole against its base", () => {
  assert.deepEqual(reviewScope("abc123", "sandcastle/issue-41", null), {
    range: "abc123...sandcastle/issue-41",
    prompt: "review-prompt.md",
    promptArgs: {},
  });
});

test("a repair on a delivered commit is reviewed alone, against that commit", () => {
  const scope = reviewScope("abc123", "sandcastle/issue-41", HEAD);
  assert.equal(scope.range, `${HEAD}..sandcastle/issue-41`);
  assert.equal(scope.prompt, "repair-review-prompt.md");
  assert.deepEqual(scope.promptArgs, { REVIEWED_HEAD: HEAD });
});

test("the repair prompt uses only the arguments a repair review is given", () => {
  const prompt = readFileSync(new URL("./repair-review-prompt.md", import.meta.url), "utf8");
  const used = new Set([...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]));
  const given = ["TASK_ID", "ISSUE_TITLE", "ISSUE_CONTEXT_FILE", "TICKET_BRANCH", "BASE_SHA", "REVIEWED_HEAD"];
  for (const name of used) assert.ok(given.includes(name ?? ""), `{{${name}}} is never supplied`);
  assert.ok(used.has("REVIEWED_HEAD"));
  // A repair may not be failed for the rest of the branch, and both verdicts must be reachable.
  assert.match(prompt, /Do not review the rest of the branch again/);
  assert.match(prompt, /<review>PASS<\/review>/);
  assert.match(prompt, /<review>FAIL<\/review>/);
});
