import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * What a ticket's last check found when the run ended with its branch kept.
 *
 * A branch that fails its last review or gate round keeps its commits for a
 * resume, but the resuming author used to be told only that the branch holds
 * work from an interrupted run. On 15 November a ticket failed its third review
 * on one small finding, after its repairs had settled every earlier one; the
 * next author would have had to guess what was wrong, and the next review would
 * have spent a round finding it again. The findings are now kept beside the
 * branch and handed to the author that resumes the same commit.
 */

/** Where a ticket's unresolved findings are kept, relative to the factory root. */
export function findingsPath(issue: number): string {
  return `.sandcastle/patches/sandcastle-issue-${issue}/unresolved-findings.md`;
}

export interface KeptFindings {
  /** The branch's commit when the run ended. */
  readonly head: string;
  /** Which check raised them: "review", "gate", "Swift lint" or "Swift compile". */
  readonly source: string;
}

const HEADER = /^<!-- findings for ([0-9a-f]{7,64}) from (.+) -->$/;

/** Keep `text`, the check's findings about commit `head`, in `file`. */
export function saveFindings(file: string, kept: KeptFindings, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `<!-- findings for ${kept.head} from ${kept.source} -->\n\n${text.trim()}\n`,
  );
}

/** The commit and the check the findings in `file` belong to, or null when there are none. */
export function readFindings(file: string): KeptFindings | null {
  if (!existsSync(file)) return null;
  const match = HEADER.exec(readFileSync(file, "utf8").split("\n", 1)[0] ?? "");
  const [, head, source] = match ?? [];
  return head === undefined || source === undefined ? null : { head, source };
}

/**
 * The findings that still apply to a resume of commit `resumeHead`. Findings
 * about another commit describe a branch that has since moved or been rebuilt.
 */
export function findingsFor(file: string, resumeHead: string | null): KeptFindings | null {
  const kept = readFindings(file);
  return kept !== null && kept.head === resumeHead ? kept : null;
}

/** What the resuming author is told about the findings the last run left. */
export function findingsNote(path: string, source: string): string {
  return [
    ` The last run of this ticket ended with ${source} findings it did not resolve.`,
    `They are in ${path}. Read that file first, check each blocking finding against the`,
    "branch as it is now, and fix every one that still holds before anything else;",
    "what it lists as verified is done and needs no rework.",
  ].join(" ");
}
