import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * Failures that have passed on re-run with no source change. A check that
 * fails on one of these is re-run once before a repair agent is spent on it,
 * so a flake never consumes the head's one repair or a sandbox. The list is
 * deliberately short: a signature added here must be a test or fault actually
 * seen to pass on re-run, not a guess. A genuine compile error matches nothing
 * and goes straight to the repair path.
 */
export const FLAKY_TEST_CLASSES: readonly string[] = [
  // Komotion has no failure confirmed to pass on an unchanged re-run yet. Add a
  // signature here only with that evidence; a guess would silently re-run a
  // real failure and hide a branch defect.
];

const TRANSIENT_INFRA = [
  "Gradle daemon disappeared",
  "OutOfMemoryError",
  "Could not reserve enough space",
];

/** Test source extensions in which an entry may be declared. */
const TEST_SOURCE_EXTENSIONS = [".kt", ".swift"];

/** Directories that hold no first-party test declarations (generated or external). */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".kotlin",
  "build",
  "data",
  "dist",
  "node_modules",
]);

/** Every first-party Kotlin/Swift test source under `root`. */
function testSourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return; // An unreadable directory cannot prove an entry is missing.
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(join(directory, entry.name));
        }
      } else if (entry.isFile() && TEST_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(join(directory, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function wholeWord(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "u");
}

/**
 * Flake-list entries that no longer name a test declared under `root`.
 *
 * Only first-party Kotlin/Swift sources count, so an entry cannot be kept alive
 * by a mention in a log fixture, a timing doc, the flake list, or this check's
 * own test. `verifySandcastle` fails when this is non-empty, which keeps a
 * stabilized or deleted suite from lingering as a silent retry.
 */
export function missingFlakyTests(
  root: string,
  names: readonly string[] = FLAKY_TEST_CLASSES,
): string[] {
  const missing = new Set(names);
  for (const file of testSourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    for (const name of missing) {
      if (wholeWord(name).test(source)) missing.delete(name);
    }
    if (missing.size === 0) break;
  }
  return names.filter((name) => missing.has(name));
}

/** The flake signature a failed check's log carries, or null for a real fault. */
export function flakyFailure(
  log: string,
  names: readonly string[] = FLAKY_TEST_CLASSES,
): string | null {
  for (const name of names) {
    if (log.includes(name)) return `${name} (known flake)`;
  }
  for (const pattern of TRANSIENT_INFRA) {
    if (log.includes(pattern)) return pattern;
  }
  return null;
}
