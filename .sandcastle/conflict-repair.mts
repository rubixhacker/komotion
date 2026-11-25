import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * What the repair agent is told when a factory pull request conflicts with
 * `main`.
 *
 * GitHub cannot rebase a conflicting branch, so the request can never merge
 * and nothing about its checks will change that. The host moves the branch
 * onto current `main` and applies the branch's whole change to the working
 * tree with the conflicts left in the files, which turns the rebase into
 * ordinary work for the agent: edit the files, build, commit once.
 */
export type ConflictRepair = {
  readonly prNumber: number;
  /** The branch head the pull request still shows, kept for comparison. */
  readonly oldHead: string;
  /** The `main` commit the branch now sits on. */
  readonly main: string;
  readonly conflicted: readonly string[];
  /** The commit message to reuse, relative to the worktree. */
  readonly messageFile: string;
};

export function conflictRepairContext(repair: ConflictRepair): string {
  return [
    `Pull request #${repair.prNumber} conflicts with main, so it cannot merge.`,
    "",
    `The host has moved this branch onto main at ${repair.main} and applied the branch's whole`,
    `change (git merge --squash of the old head ${repair.oldHead}) to the working tree, uncommitted.`,
    "These files hold conflict markers:",
    ...repair.conflicted.map((path) => `- ${path}`),
    "",
    "Resolve every conflict:",
    "- Keep what main changed. Where main restructured code the branch also touched, reapply the",
    "  branch's change to main's version; do not restore the branch's older copy over it.",
    `- \`git show ${repair.oldHead}\` shows what the branch changed; \`git log -p ${repair.main} -- <path>\``,
    "  shows what main changed.",
    "- A clean merge can still be wrong: main may have added a caller of something the branch",
    "  renamed or removed. Search for each declaration the branch changed and fix every use.",
    "- Compile and run the focused tests of every module you touch, and run spotlessCheck.",
    "",
    "Then stage the change and commit it as one commit with the branch's own message:",
    `  git commit -F ${repair.messageFile}`,
    "Do not run git rebase, git merge or git reset, and do not push.",
  ].join("\n");
}

/** A line git writes at the start or end of an unresolved conflict. */
export const CONFLICT_MARKER = "^(<<<<<<<|>>>>>>>)( |$)";

/**
 * The factory runs git on the host, outside a sandbox, and its runtime checkout
 * has no `user.name`/`user.email`. Both `merge --squash` and `commit` need a
 * committer identity, so every host git call carries one.
 */
const FACTORY_GIT_IDENTITY: Readonly<NodeJS.ProcessEnv> = {
  GIT_AUTHOR_NAME: "Sandcastle Factory",
  GIT_AUTHOR_EMAIL: "factory@caffconscious.invalid",
  GIT_COMMITTER_NAME: "Sandcastle Factory",
  GIT_COMMITTER_EMAIL: "factory@caffconscious.invalid",
};

function git(tree: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: tree,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...FACTORY_GIT_IDENTITY },
  }).trim();
}

export type RebaseStart =
  /** The branch cannot be rebased here; nothing was changed. */
  | { readonly state: "refused"; readonly reason: string }
  /** Git applied the change without help and the host committed it. */
  | { readonly state: "applied"; readonly head: string }
  /** The files in `conflicted` hold markers for the agent to resolve. */
  | { readonly state: "conflicted"; readonly conflicted: readonly string[] };

/**
 * Move the branch checked out in `tree` onto `main` and apply its whole change
 * there. `expected` is the head the pull request shows; a branch that is
 * anywhere else is refused, because the push that follows overwrites that head.
 * `messageFile` (relative to `tree`) receives the branch's first commit
 * message, which the one new commit reuses.
 */
export function startConflictRebase(
  tree: string,
  branch: string,
  expected: string,
  main: string,
  messageFile: string,
): RebaseStart {
  if (git(tree, "rev-parse", "HEAD") !== expected)
    return { state: "refused", reason: "local-branch-differs" };
  if (git(tree, "rev-parse", "--abbrev-ref", "HEAD") !== branch)
    return { state: "refused", reason: "branch-not-checked-out" };
  const first = git(tree, "rev-list", "--reverse", `${main}..${expected}`).split("\n")[0];
  if (!first) return { state: "refused", reason: "already-on-main" };
  writeFileSync(
    resolve(tree, messageFile),
    `${git(tree, "log", "-1", "--format=%B", first)}\n`,
  );
  // The host copies its current prompt files over the branch's, so the tree is
  // rarely clean here; nothing in it is work, and the reset drops it. A repair
  // that stopped mid-merge can leave MERGE_HEAD behind: `reset --hard` does not
  // clear it, and `git merge --squash` then refuses before touching a file.
  spawnSync("git", ["merge", "--abort"], { cwd: tree, encoding: "utf8" });
  git(tree, "reset", "--hard", main);
  // Exits non-zero on a conflict (the case this exists for) and on any other
  // merge failure. Those failures also leave no staged change, so reading the
  // empty status without the exit code mislabels them "already-on-main" and
  // escalates a recoverable PR to a human. Capture the failure and name it.
  const merge = spawnSync("git", ["merge", "--squash", expected], {
    cwd: tree,
    encoding: "utf8",
    env: { ...process.env, ...FACTORY_GIT_IDENTITY },
  });
  const conflicted = git(tree, "diff", "--name-only", "--diff-filter=U")
    .split("\n")
    .filter(Boolean);
  if (conflicted.length > 0) return { state: "conflicted", conflicted };
  if (merge.status !== 0) {
    const detail = merge.stderr?.trim() || `git exited ${String(merge.status)}`;
    restoreBranch(tree, expected);
    return { state: "refused", reason: `merge-failed: ${detail}` };
  }
  if (git(tree, "status", "--porcelain", "--untracked-files=no") === "") {
    restoreBranch(tree, expected);
    return { state: "refused", reason: "already-on-main" };
  }
  execFileSync("git", ["commit", "--quiet", "-F", messageFile], {
    cwd: tree,
    encoding: "utf8",
    env: { ...process.env, ...FACTORY_GIT_IDENTITY },
  });
  return { state: "applied", head: git(tree, "rev-parse", "HEAD") };
}

/**
 * Why the branch in `tree` is not a finished rebase onto `main`, or null when
 * it is: one or more commits on top of `main`, nothing unmerged, and no marker
 * left in a file that conflicted. The agent's word is not the evidence.
 */
export function rebaseFault(
  tree: string,
  branch: string,
  main: string,
  conflicted: readonly string[],
): string | null {
  if (git(tree, "diff", "--name-only", "--diff-filter=U") !== "") return "conflicts-unresolved";
  const head = git(tree, "rev-parse", "HEAD");
  if (head === main) return "no-repair-commit";
  if (git(tree, "rev-parse", branch) !== head || git(tree, "merge-base", main, head) !== main)
    return "branch-not-on-main";
  if (git(tree, "rev-list", "--merges", `${main}..${head}`) !== "") return "merge-commit";
  const present = conflicted.filter(
    (path) => spawnSync("git", ["cat-file", "-e", `${head}:${path}`], { cwd: tree }).status === 0,
  );
  if (present.length === 0) return null;
  const markers = spawnSync(
    "git",
    ["grep", "-q", "-E", CONFLICT_MARKER, head, "--", ...present],
    { cwd: tree },
  );
  return markers.status === 0 ? "conflict-markers-left" : null;
}

/**
 * Put the branch back on the head the pull request shows. A branch left on a
 * half-resolved tree would read as new work to the next pass.
 */
export function restoreBranch(tree: string, head: string): void {
  spawnSync("git", ["reset", "--hard", head], { cwd: tree, encoding: "utf8" });
}

/**
 * Make the pull request head the local branch head before a conflict rebase.
 *
 * A repair can commit to a worker's branch and then stop before pushing (a
 * rejected review, a failed gate). The local branch then sits beside or ahead
 * of the head GitHub shows, and `startConflictRebase` refuses to overwrite
 * what it takes for someone else's push. Those local commits are unreviewed
 * and are not part of the pull request, so the delivered head wins: discard
 * them and rebase from what is actually under review.
 *
 * Returns the local head that was discarded, or null when the branch already
 * matched the pull request head.
 */
export function reconcileToPrHead(tree: string, branch: string, prHead: string): string | null {
  const local = git(tree, "rev-parse", "HEAD");
  if (local === prHead) return null;
  // The pass fetched origin before the worker started, but a long repair can
  // outlive that fetch. Fetch only when the object is genuinely missing.
  const present = () => spawnSync("git", ["cat-file", "-e", `${prHead}^{commit}`], { cwd: tree });
  if (present().status !== 0) {
    const fetch = spawnSync("git", ["fetch", "origin", branch], { cwd: tree, encoding: "utf8" });
    if (fetch.status !== 0)
      throw new Error(`could not fetch ${branch} to reconcile the PR head: ${fetch.stderr?.trim() ?? ""}`);
    if (present().status !== 0) throw new Error(`PR head ${prHead} is unavailable after fetching ${branch}`);
  }
  restoreBranch(tree, prHead);
  return local;
}
