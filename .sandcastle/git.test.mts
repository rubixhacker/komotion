// Non-interactive git operations on the unattended host: no editor may open
// for an amend, a rebase todo list, or a credential prompt.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, nonInteractiveGitEnv } from "./process.mts";

test("nonInteractiveGitEnv disables editors and prompts", () => {
  const env = nonInteractiveGitEnv();
  assert.equal(env.GIT_EDITOR, "true");
  assert.equal(env.GIT_SEQUENCE_EDITOR, "true");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
});

test("an amend and an interactive rebase complete without an editor", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "komotion-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = nonInteractiveGitEnv();
  const git = (args: readonly string[]) => command("git", [...args], { cwd: dir, env, timeoutMs: 30_000 });

  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "Sandcastle Test"]);
  await git(["config", "user.email", "sandcastle@example.test"]);
  writeFileSync(join(dir, "file.txt"), "base\n");
  await git(["add", "file.txt"]);
  await git(["commit", "-q", "-m", "base"]);

  await git(["checkout", "-q", "-b", "topic"]);
  writeFileSync(join(dir, "topic.txt"), "topic\n");
  await git(["add", "topic.txt"]);
  await git(["commit", "-q", "-m", "topic old"]);
  // No -m: git opens GIT_EDITOR, which must be the no-op `true`.
  await git(["commit", "-q", "--amend"]);

  await git(["checkout", "-q", "main"]);
  writeFileSync(join(dir, "main.txt"), "main\n");
  await git(["add", "main.txt"]);
  await git(["commit", "-q", "-m", "base2"]);

  await git(["checkout", "-q", "topic"]);
  // -i opens GIT_SEQUENCE_EDITOR; the no-op keeps the default todo list.
  await git(["rebase", "-i", "main"]);

  const log = await git(["log", "--oneline"]);
  assert.match(log, /base2/);
  assert.match(log, /topic old/);
  assert.equal(await git(["status", "--porcelain"]), "");
});
