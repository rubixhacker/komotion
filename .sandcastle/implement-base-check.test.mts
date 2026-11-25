import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const implementPrompt = readFileSync(new URL("./implement-prompt.md", import.meta.url), "utf8");
const guidance = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

const STEERING_READING = /^Read AGENTS\.md, README\.md/mu;

function baseCheckBlock(): string {
  const start = implementPrompt.search(/^Base check — /mu);
  const end = implementPrompt.search(STEERING_READING);
  assert.ok(start > 0, "the implement prompt must open with a base check");
  assert.ok(end > start, "the base check must precede steering-doc reading");
  return implementPrompt.slice(start, end);
}

test("the implement workflow opens with a base check before any source or issue exploration", () => {
  const base = implementPrompt.search(/^Base check — /mu);
  assert.ok(base < implementPrompt.search(/# REPOSITORY/mu));

  const block = baseCheckBlock();
  assert.match(block, /git fetch origin main/u);
  assert.match(block, /compare `HEAD` with it/u);
  assert.match(block, /git merge-base --is-ancestor HEAD origin\/main/u);
});

test("the prompt tells the author how to use a pre-author advisory", () => {
  const advisory = implementPrompt.search(/^A pre-author advisory in the issue context/mu);
  assert.ok(advisory > 0);
  assert.ok(advisory < implementPrompt.search(/^Base check — /mu));
  const block = implementPrompt.slice(advisory, implementPrompt.search(/^Base check — /mu));
  assert.match(block, /fix the cause it reports before you edit the branch/u);
  assert.match(block, /advice, not a gate/u);
});

test("a stale worktree reads current steering and lane inventory before naming the system", () => {
  const block = baseCheckBlock();
  assert.match(block, /git show origin\/main:AGENTS\.md/u);
  assert.match(block, /git show origin\/main:\.sandcastle\/README\.md/u);
  assert.match(block, /lane inventory/u);
  assert.match(block, /before you\s+identify the system the ticket names/u);
  assert.match(block, /event-driven `factory` lane/u);
  assert.match(block, /unrelated\s+ETL submission-triage system/u);
});

test("the base check is moved into the workflow, not duplicated in always-loaded guidance", () => {
  assert.doesNotMatch(
    guidance,
    /checks its branch base against `origin\/main` before writing code/u,
  );
  assert.doesNotMatch(guidance, /^Base check — /mu);

  const block = baseCheckBlock();
  assert.match(block, /Rebase first so\s+verification runs once against the final base/u);
  assert.match(block, /follow-up\s+issues that assume a prerequisite fix only in/u);
  assert.match(block, /stale-branch guard is only the backstop/u);
});
