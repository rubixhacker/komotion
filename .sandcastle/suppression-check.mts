/**
 * Finds the lint suppressions a branch adds.
 *
 * The repository's rule is that a suppression, a baseline entry or a relaxed
 * check needs the owner's permission for that one finding. The agents are told
 * so, and still added one in six of the runs up to 15 November, most often to
 * get a gate to pass. A reviewer may or may not notice. This reads the
 * branch's diff on the host, so a suppression never reaches review unseen: it
 * comes back to the author as a finding to remove.
 */

const SUPPRESSION =
  /@(file:)?Suppress(Lint|Warnings)?\s*\(|swiftlint:disable|tools:ignore\s*=|\/\/\s*noinspection\b|biome-ignore|ktlint-disable|detekt:disable|@Ignore\b|XCTSkip\(/;
/** Files whose every added line hides findings. */
const BASELINE = /(^|\/)(baseline[^/]*\.xml|lint-baseline\.xml|[^/]*-baseline\.(tsv|txt|xml))$/;
const TEST_FILE =
  /(^|\/)(test|androidTest|androidHostTest|commonTest|iosTest|jvmTest|[A-Za-z]*Tests|[A-Za-z]*UITests)\//;
const EXEMPT = /^(\.sandcastle\/|docs\/)|\.md$/;

export interface AddedSuppression {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The suppressions in `diff`, a unified diff with zero or more context lines.
 * A line the diff also removes from the same file is a move, not an addition.
 * Test sources are left to the reviewer, apart from a disabled or skipped
 * test, which is the same bypass in another place.
 */
export function addedSuppressions(diff: string): AddedSuppression[] {
  const found: AddedSuppression[] = [];
  let file = "";
  let line = 0;
  let removed = new Map<string, number>();
  let pending: AddedSuppression[] = [];
  const flush = (): void => {
    for (const hit of pending) {
      const moved = removed.get(hit.text) ?? 0;
      if (moved > 0) removed.set(hit.text, moved - 1);
      else found.push(hit);
    }
    pending = [];
    removed = new Map();
  };
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      flush();
      file = row.slice(4).replace(/^b\//, "");
      continue;
    }
    if (row.startsWith("--- ") || row.startsWith("diff --git")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
    if (hunk !== null) {
      line = Number(hunk[1]);
      continue;
    }
    if (row.startsWith("-")) {
      const text = row.slice(1).trim();
      removed.set(text, (removed.get(text) ?? 0) + 1);
      continue;
    }
    if (row.startsWith("+")) {
      const text = row.slice(1).trim();
      const inTests = TEST_FILE.test(file);
      const hides = BASELINE.test(file)
        ? text !== "" && !/^<\/?(\w+:)?(SmellBaseline|ManuallySuppressedIssues|CurrentIssues|issues)\b|^<\?xml/.test(text)
        : inTests
          ? /@Ignore\b|XCTSkip\(/.test(text)
          : SUPPRESSION.test(text);
      if (hides && file !== "/dev/null" && !EXEMPT.test(file)) pending.push({ file, line, text });
      line += 1;
      continue;
    }
    if (row.startsWith(" ")) line += 1;
  }
  flush();
  return found;
}

/** What the author is told to do about them. */
export function suppressionFindings(found: readonly AddedSuppression[]): string {
  return [
    `The branch adds ${found.length} suppression(s) or baseline entr${found.length === 1 ? "y" : "ies"}. This repository does not accept one without the owner's permission for that exact finding, and a ticket does not grant it by asking for a green gate.`,
    "Remove each one and fix what it was hiding. If a finding cannot be fixed, emit BLOCKED and say which finding and why; do not hide it another way.",
    "",
    ...found.slice(0, 40).map((hit) => `- ${hit.file}:${hit.line}: ${hit.text.slice(0, 160)}`),
    ...(found.length > 40 ? [`- ... and ${found.length - 40} more`] : []),
  ].join("\n");
}
