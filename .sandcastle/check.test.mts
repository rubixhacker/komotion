// Tests for the environment check's host-side validation (check.mts).
//
// The two historical bugs the validation exists to catch:
//
// - a non-existent gh subcommand (the host called `gh label add`, which
//   does not exist);
// - a reserved prompt argument passed via promptArgs (the reviewer run
//   passed TARGET_BRANCH, which the runtime injects itself).

import test from "node:test";
import assert from "node:assert/strict";
import { ghCommandFailures, promptArgFailures, RESERVED_PROMPT_ARGS } from "./check.mts";

test("RESERVED_PROMPT_ARGS is the source/target branch pair", () => {
  assert.deepEqual(RESERVED_PROMPT_ARGS, ["SOURCE_BRANCH", "TARGET_BRANCH"]);
});

test("promptArgFailures rejects a reserved prompt argument", () => {
  const failures = promptArgFailures([
    ["reviewer", { BRANCH: "b", TARGET_BRANCH: "origin/main" }],
    ["implementer", { TASK_ID: "1", SOURCE_BRANCH: "b" }],
  ]);
  assert.deepEqual(failures, [
    "reviewer passes built-in prompt argument TARGET_BRANCH via promptArgs",
    "implementer passes built-in prompt argument SOURCE_BRANCH via promptArgs",
  ]);
});

test("promptArgFailures accepts the factory and triage prompt arguments", () => {
  assert.deepEqual(
    promptArgFailures([
      ["planner", { ISSUES: "[]" }],
      ["implementer", { TASK_ID: "1", ISSUE_TITLE: "t", BRANCH: "b", ISSUE_CONTEXT_FILE: "c.json" }],
      ["reviewer", { BRANCH: "b" }],
      ["triage", { ISSUES: "[]" }],
    ]),
    [],
  );
});

const FACTORY_GH_COMMANDS: readonly (readonly string[])[] = [
  ["api"],
  ["issue", "list"],
  ["issue", "edit"],
  ["issue", "comment"],
  ["pr", "list"],
  ["pr", "create"],
  ["pr", "merge"],
  ["pr", "checks"],
];

const TRIAGE_GH_COMMANDS: readonly (readonly string[])[] = [
  ["api"],
  ["issue", "list"],
  ["issue", "edit"],
  ["issue", "comment"],
];

// A probe that mimics the installed gh: a subcommand path it does not
// have fails with gh's `unknown command` output, a path it has fails with
// some other output (missing arguments, no repository context), which
// means the command exists.
function ghProbe(valid: readonly (readonly string[])[]) {
  return (command: readonly string[]) => {
    const known = valid.some(
      (path) => command.length >= path.length && path.every((part, i) => part === command[i]),
    );
    if (!known)
      throw new Error(`unknown command "${command.at(-1)}" for "gh ${command.slice(0, -1).join(" ")}"`);
    throw new Error("accepts 1 arg(s), received 0");
  };
}

test("ghCommandFailures rejects a subcommand the installed gh does not have", async () => {
  const failures = await ghCommandFailures(
    [["label", "add"], ["issue", "edit"]],
    ghProbe(FACTORY_GH_COMMANDS),
  );
  assert.deepEqual(failures, ["gh has no 'label add' command"]);
});

test("ghCommandFailures accepts subcommands the installed gh has", async () => {
  assert.deepEqual(await ghCommandFailures(FACTORY_GH_COMMANDS, ghProbe(FACTORY_GH_COMMANDS)), []);
  assert.deepEqual(await ghCommandFailures(TRIAGE_GH_COMMANDS, ghProbe(TRIAGE_GH_COMMANDS)), []);
});
