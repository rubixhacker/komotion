import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * What a stalled run leaves behind for the next attempt.
 *
 * A run that ran out its budget used to lose everything it had not committed:
 * the next pass swept the worktree, and the next author started from nothing.
 * On 15 November an author spent two hours on a ticket, stalled debugging one
 * test, and all of its changes went with the worktree. The uncommitted changes
 * are now saved as a patch, and the next author of the ticket is handed it.
 */

/** Where a ticket's stalled changes are kept, relative to the factory root. */
export function stalledPatchPath(issue: number): string {
  return `.sandcastle/patches/sandcastle-issue-${issue}/stalled-attempt.patch`;
}

/** Larger than any real ticket; a bigger diff is build output that escaped .gitignore. */
const PATCH_LIMIT = 8 * 1024 * 1024;

/**
 * Save the worktree's uncommitted changes, new files included, to `patchFile`.
 * Returns whether there was anything to save. `git` runs one git command in
 * the worktree and returns its output.
 */
export function saveStalledWork(
  patchFile: string,
  git: (args: readonly string[]) => string,
): boolean {
  // Staging is how a diff comes to include files git does not track yet.
  git(["add", "-A", "--", ".", ":!.sandcastle"]);
  const diff = git(["diff", "--cached", "--binary", "HEAD"]);
  if (diff.trim() === "" || diff.length > PATCH_LIMIT) return false;
  mkdirSync(dirname(patchFile), { recursive: true });
  writeFileSync(patchFile, diff.endsWith("\n") ? diff : `${diff}\n`);
  return true;
}

/** What the next author is told about the patch a stalled run left. */
export function stalledWorkNote(patchPath: string, reason: string | null): string {
  return [
    ` An earlier run of this ticket stopped before it committed${reason === null ? "" : ` (${reason})`}.`,
    `Its uncommitted changes are in ${patchPath}. Read that patch before you write anything:`,
    "apply what is sound with `git apply --3way`, fix or drop the rest, and do not repeat",
    "the investigation it already did. If it was stuck on one failing check, find why that",
    "check fails before you run it again.",
  ].join(" ");
}
