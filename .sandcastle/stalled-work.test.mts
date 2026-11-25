import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStalledWork, stalledPatchPath, stalledWorkNote } from "./stalled-work.mjs";

function repository(): { readonly path: string; readonly git: (args: readonly string[]) => string } {
  const path = mkdtempSync(join(tmpdir(), "stalled-work-"));
  const git = (args: readonly string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
      cwd: path,
      encoding: "utf8",
    });
  git(["init", "-q"]);
  // The host's global git config may force signed commits; the fixture
  // sets its own signing policy so the check passes on any host.
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(path, "tracked.txt"), "one\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "base"]);
  return { path, git };
}

test("a stalled run's edits and new files are saved as one patch that applies", () => {
  const { path, git } = repository();
  try {
    writeFileSync(join(path, "tracked.txt"), "one\ntwo\n");
    writeFileSync(join(path, "new-test.txt"), "added by the stalled run\n");
    // The factory's own files in the worktree are not the ticket's work.
    mkdirSync(join(path, ".sandcastle"));
    writeFileSync(join(path, ".sandcastle", "delivery.md"), "notes\n");
    const patch = join(path, "..", `${path.split("/").pop()}.patch`);
    assert.equal(saveStalledWork(patch, git), true);
    const text = readFileSync(patch, "utf8");
    assert.match(text, /tracked\.txt/);
    assert.match(text, /new-test\.txt/);
    assert.doesNotMatch(text, /delivery\.md/);
    // The patch restores the work on a clean checkout of the same commit.
    git(["reset", "-q", "--hard", "HEAD"]);
    git(["clean", "-qfd"]);
    git(["apply", "--3way", patch]);
    assert.equal(readFileSync(join(path, "new-test.txt"), "utf8"), "added by the stalled run\n");
    rmSync(patch);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test("a stalled run that changed nothing saves no patch", () => {
  const { path, git } = repository();
  try {
    const patch = join(path, "..", `${path.split("/").pop()}.patch`);
    assert.equal(saveStalledWork(patch, git), false);
    assert.equal(existsSync(patch), false);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test("the next author is told where the patch is and why the run stopped", () => {
  assert.equal(
    stalledPatchPath(41),
    ".sandcastle/patches/sandcastle-issue-41/stalled-attempt.patch",
  );
  const note = stalledWorkNote(stalledPatchPath(41), "no completion within 120 minutes");
  assert.match(note, /sandcastle-issue-41\/stalled-attempt\.patch/);
  assert.match(note, /no completion within 120 minutes/);
  assert.match(note, /git apply --3way/);
  assert.doesNotMatch(stalledWorkNote(stalledPatchPath(41), null), /\(\)/);
});
