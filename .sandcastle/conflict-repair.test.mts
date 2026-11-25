import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFLICT_MARKER,
  conflictRepairContext,
  rebaseFault,
  reconcileToPrHead,
  restoreBranch,
  startConflictRebase,
} from "./conflict-repair.mjs";

const BRANCH = "sandcastle/issue-1";
const MESSAGE_FILE = ".sandcastle/message.txt";

/**
 * A repository whose ticket branch changed `a.txt` and added `ticket.txt`,
 * while `main` moved on: it changed `a.txt` too when `conflicting`, and
 * `other.txt` otherwise.
 */
function repository(conflicting: boolean) {
  const tree = mkdtempSync(join(tmpdir(), "sandcastle-conflict-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: tree, encoding: "utf8" }).trim();
  const commit = (path: string, text: string, message: string) => {
    writeFileSync(join(tree, path), text);
    git("add", path);
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "factory@example.invalid");
  git("config", "user.name", "Factory");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(tree, ".sandcastle"));
  writeFileSync(join(tree, ".gitignore"), ".sandcastle/\n");
  git("add", ".gitignore");
  commit("a.txt", "one\ntwo\nthree\n", "start");
  commit("other.txt", "other\n", "more");
  git("switch", "--quiet", "-c", BRANCH);
  commit("a.txt", "one\nticket\nthree\n", "feat: the ticket\n\nIts body.");
  const old = commit("ticket.txt", "new file\n", "fix: a repair round");
  git("switch", "--quiet", "main");
  const main = conflicting
    ? commit("a.txt", "one\nmain\nthree\n", "main moves")
    : commit("other.txt", "changed\n", "main moves");
  git("switch", "--quiet", BRANCH);
  return { tree, git, old, main, dispose: () => rmSync(tree, { recursive: true, force: true }) };
}

test("the agent is told which files conflict and how to commit", () => {
  const context = conflictRepairContext({
    prNumber: 2181,
    oldHead: "a".repeat(40),
    main: "b".repeat(40),
    conflicted: ["shared/A.kt", "shared/B.kt"],
    messageFile: ".sandcastle/repair-failure-2131-message.txt",
  });
  assert.ok(context.includes("- shared/A.kt\n- shared/B.kt"));
  assert.ok(context.includes(`git show ${"a".repeat(40)}`));
  assert.ok(context.includes("git commit -F .sandcastle/repair-failure-2131-message.txt"));
});

test("only the lines git writes around a conflict count as markers", () => {
  const marker = new RegExp(CONFLICT_MARKER);
  assert.ok(marker.test("<<<<<<< HEAD"));
  assert.ok(marker.test(">>>>>>> abc1234 (a commit)"));
  assert.ok(marker.test(">>>>>>>"));
  assert.ok(!marker.test("======="));
  assert.ok(!marker.test("    <<<<<<< indented text"));
  assert.ok(!marker.test("<<<<<<<<< a longer run"));
});

test("a change git applies without help becomes one commit on main", () => {
  const repo = repository(false);
  try {
    const start = startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    assert.equal(start.state, "applied");
    assert.equal(repo.git("rev-parse", "HEAD~1"), repo.main);
    assert.equal(repo.git("log", "-1", "--format=%s"), "feat: the ticket");
    assert.equal(repo.git("diff", "--name-only", "HEAD~1", "HEAD"), "a.txt\nticket.txt");
    assert.equal(rebaseFault(repo.tree, BRANCH, repo.main, []), null);
  } finally {
    repo.dispose();
  }
});

test("a conflict is left in the file for the agent, and its commit is accepted", () => {
  const repo = repository(true);
  try {
    const start = startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    assert.deepEqual(start, { state: "conflicted", conflicted: ["a.txt"] });
    assert.match(readFileSync(join(repo.tree, "a.txt"), "utf8"), /^<<<<<<< /m);
    assert.equal(rebaseFault(repo.tree, BRANCH, repo.main, ["a.txt"]), "conflicts-unresolved");

    writeFileSync(join(repo.tree, "a.txt"), "one\nmain and ticket\nthree\n");
    repo.git("add", "a.txt");
    repo.git("commit", "--quiet", "-F", MESSAGE_FILE);
    assert.equal(rebaseFault(repo.tree, BRANCH, repo.main, ["a.txt"]), null);
    assert.equal(repo.git("rev-list", "--count", `${repo.main}..HEAD`), "1");
    assert.equal(repo.git("log", "-1", "--format=%B"), "feat: the ticket\n\nIts body.");
    assert.equal(repo.git("show", "HEAD:ticket.txt"), "new file");
  } finally {
    repo.dispose();
  }
});

test("a commit that still holds a marker is not a finished rebase", () => {
  const repo = repository(true);
  try {
    startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    repo.git("add", "a.txt");
    repo.git("commit", "--quiet", "-m", "resolved badly");
    assert.equal(rebaseFault(repo.tree, BRANCH, repo.main, ["a.txt"]), "conflict-markers-left");
  } finally {
    repo.dispose();
  }
});

test("an agent that commits nothing leaves no rebase, and the branch goes back", () => {
  const repo = repository(true);
  try {
    startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    repo.git("checkout", "--theirs", "a.txt");
    repo.git("reset", "--quiet");
    assert.equal(rebaseFault(repo.tree, BRANCH, repo.main, ["a.txt"]), "no-repair-commit");
    restoreBranch(repo.tree, repo.old);
    assert.equal(repo.git("rev-parse", BRANCH), repo.old);
    assert.equal(repo.git("status", "--porcelain", "--untracked-files=no"), "");
  } finally {
    repo.dispose();
  }
});

test("a branch that is not at the pull request's head is refused untouched", () => {
  const repo = repository(true);
  try {
    const start = startConflictRebase(repo.tree, BRANCH, repo.main, repo.main, MESSAGE_FILE);
    assert.deepEqual(start, { state: "refused", reason: "local-branch-differs" });
    assert.equal(repo.git("rev-parse", "HEAD"), repo.old);
  } finally {
    repo.dispose();
  }
});

test("a branch already at the pull request head needs no reconciliation", () => {
  const repo = repository(true);
  try {
    assert.equal(reconcileToPrHead(repo.tree, BRANCH, repo.old), null);
    assert.equal(repo.git("rev-parse", "HEAD"), repo.old);
    assert.equal(repo.git("status", "--porcelain", "--untracked-files=no"), "");
  } finally {
    repo.dispose();
  }
});

test("unpushed repair commits are discarded back to the pull request head", () => {
  const repo = repository(true);
  try {
    writeFileSync(join(repo.tree, "unpushed.txt"), "a repair that never landed\n");
    repo.git("add", "unpushed.txt");
    repo.git("commit", "--quiet", "-m", "unpushed repair evidence");
    const stranded = repo.git("rev-parse", "HEAD");
    assert.equal(reconcileToPrHead(repo.tree, BRANCH, repo.old), stranded);
    assert.equal(repo.git("rev-parse", "HEAD"), repo.old);
    assert.equal(repo.git("rev-parse", BRANCH), repo.old);
    assert.equal(repo.git("status", "--porcelain", "--untracked-files=no"), "");
    assert.throws(() => readFileSync(join(repo.tree, "unpushed.txt")));
  } finally {
    repo.dispose();
  }
});

test("a local branch rebased beside the pull request head is restored to it", () => {
  const repo = repository(false);
  try {
    // A rebase produces the same patch under a new hash: a sibling of the PR
    // head that shares its parent but is not the same commit.
    const tree = repo.git("rev-parse", `${repo.old}^{tree}`);
    const parent = repo.git("rev-parse", `${repo.old}^`);
    const sibling = repo.git("commit-tree", tree, "-p", parent, "-m", "rebased copy");
    repo.git("reset", "--hard", sibling);
    assert.notEqual(repo.git("rev-parse", "HEAD"), repo.old);
    assert.equal(reconcileToPrHead(repo.tree, BRANCH, repo.old), sibling);
    assert.equal(repo.git("rev-parse", "HEAD"), repo.old);
    assert.equal(repo.git("rev-parse", BRANCH), repo.old);
  } finally {
    repo.dispose();
  }
});

test("a diverged local branch can still be rebased when the PR head conflicts with main", () => {
  // The #2713 shape: a repair left the local branch beside the PR head, and
  // main moved into the PR head's path. Reconciliation must let the conflict
  // rebase run instead of refusing it.
  const repo = repository(true);
  try {
    const tree = repo.git("rev-parse", `${repo.old}^{tree}`);
    const parent = repo.git("rev-parse", `${repo.old}^`);
    const sibling = repo.git("commit-tree", tree, "-p", parent, "-m", "local rebase");
    repo.git("reset", "--hard", sibling);
    assert.equal(reconcileToPrHead(repo.tree, BRANCH, repo.old), sibling);
    const start = startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    assert.deepEqual(start, { state: "conflicted", conflicted: ["a.txt"] });
    assert.match(readFileSync(join(repo.tree, "a.txt"), "utf8"), /^<<<<<<< /m);
  } finally {
    repo.dispose();
  }
});

test("the squash commit works even with no git identity in the checkout", () => {
  // The host commits outside a sandbox and the runtime checkout has no
  // user.name/user.email; the commit must carry its own identity.
  const repo = repository(false);
  try {
    repo.git("config", "--unset", "user.email");
    repo.git("config", "--unset", "user.name");
    const saved = {
      authorName: process.env.GIT_AUTHOR_NAME,
      authorEmail: process.env.GIT_AUTHOR_EMAIL,
      committerName: process.env.GIT_COMMITTER_NAME,
      committerEmail: process.env.GIT_COMMITTER_EMAIL,
    };
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_COMMITTER_NAME;
    delete process.env.GIT_COMMITTER_EMAIL;
    try {
      const start = startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
      assert.equal(start.state, "applied", JSON.stringify(start));
      assert.equal(repo.git("log", "-1", "--format=%an <%ae>"), "Sandcastle Factory <factory@caffconscious.invalid>");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    repo.dispose();
  }
});

test("a stale MERGE_HEAD from a stopped repair does not block the rebase", () => {
  // `git reset --hard` leaves MERGE_HEAD in place, so a repair that stopped
  // mid-merge used to make the next squash refuse with "not concluded" and an
  // empty status — misread as "already-on-main" and escalated to a human.
  const repo = repository(false);
  try {
    writeFileSync(join(repo.tree, repo.git("rev-parse", "--git-path", "MERGE_HEAD")), `${repo.old}\n`);
    const start = startConflictRebase(repo.tree, BRANCH, repo.old, repo.main, MESSAGE_FILE);
    assert.equal(start.state, "applied");
    assert.equal(repo.git("rev-parse", "HEAD~1"), repo.main);
  } finally {
    repo.dispose();
  }
});

test("a merge failure unrelated to conflicts is named instead of already-on-main", () => {
  // An orphan head has no common ancestor: `git merge --squash` refuses and
  // stages nothing, the same empty status as "already-on-main" but a real
  // error that must reach the log rather than a false "work already landed".
  const repo = repository(true);
  try {
    repo.git("switch", "--quiet", "--orphan", "unrelated");
    writeFileSync(join(repo.tree, "unrelated.txt"), "standalone root\n");
    repo.git("add", "unrelated.txt");
    repo.git("commit", "--quiet", "-m", "unrelated root");
    const orphan = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "--quiet", "-f", BRANCH);
    repo.git("reset", "--hard", orphan);
    const start = startConflictRebase(repo.tree, BRANCH, orphan, repo.main, MESSAGE_FILE);
    assert.equal(start.state, "refused");
    assert.match(start.reason, /^merge-failed: /);
    assert.match(start.reason, /unrelated histories/i);
    assert.equal(repo.git("rev-parse", "HEAD"), orphan);
    assert.equal(repo.git("status", "--porcelain", "--untracked-files=no"), "");
  } finally {
    repo.dispose();
  }
});
