/**
 * The source of a library class: `.sandcastle/agent/bin/lib-source <Class> [member]`.
 *
 * Agents needing a third-party API (MOKO Resources, Compose, Roborazzi, Vico,
 * KMP-NativeCoroutines) spent 2,129 shell calls unzipping jars from the Gradle
 * cache, running `javap` over class files one at a time and fetching sources
 * from Maven or GitHub by hand. This finds
 * the class in the dependencies Gradle already resolved, fetches the matching
 * sources jar once when the cache holds only binaries, and prints the
 * declaration asked for.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORK = process.env.SANDCASTLE_LIB_STATE ?? "/tmp/sandcastle-lib";
const REPOSITORIES = [
  "https://dl.google.com/dl/android/maven2",
  "https://maven-central.storage-download.googleapis.com/maven2",
];
const MAX_WHOLE_FILE = 260;

export interface Coordinates {
  readonly group: string;
  readonly artifact: string;
  readonly version: string;
}

/** Maven coordinates from a path in Gradle's module cache. */
export function coordinatesOf(file: string): Coordinates | null {
  const match = /files-2\.1\/([^/]+)\/([^/]+)\/([^/]+)\/[0-9a-f]+\/[^/]+$/.exec(file);
  if (match === null) return null;
  return { group: match[1] ?? "", artifact: match[2] ?? "", version: match[3] ?? "" };
}

/** Where a repository serves an artifact's sources jar. */
export function sourcesUrl(repository: string, at: Coordinates): string {
  return `${repository}/${at.group.replaceAll(".", "/")}/${at.artifact}/${at.version}/${at.artifact}-${at.version}-sources.jar`;
}

/** Index rows (`archive<TAB>entry`) whose entry is the class `name`, as source or as bytecode. */
export function entriesFor(index: readonly string[], name: string): { sources: string[]; classes: string[] } {
  const path = name.includes(".") ? name.replaceAll(".", "/") : null;
  const simple = name.split(".").at(-1) ?? name;
  const sources: string[] = [];
  const classes: string[] = [];
  for (const row of index) {
    const entry = row.slice(row.indexOf("\t") + 1);
    const stem = entry.replace(/\.(kt|java|class)$/, "");
    const matches = path === null ? stem === simple || stem.endsWith(`/${simple}`) : stem.endsWith(path);
    if (!matches) continue;
    if (/\.(kt|java)$/.test(entry)) sources.push(row);
    else if (entry.endsWith(".class")) classes.push(row);
  }
  return { sources, classes };
}

/** The part of a source file worth printing: the lines about `member`, or an outline of a long file. */
export function excerpt(source: string, member: string | null): string {
  const lines = source.split("\n");
  const numbered = (from: number, to: number): string[] =>
    lines.slice(from, to).map((line, offset) => `${String(from + offset + 1).padStart(5)}  ${line}`);
  if (member !== null) {
    const wanted = new Set<number>();
    lines.forEach((line, index) => {
      if (!new RegExp(`\\b${member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)) return;
      for (let near = Math.max(0, index - 6); near < Math.min(lines.length, index + 14); near += 1) wanted.add(near);
    });
    if (wanted.size === 0) return `No line mentions \`${member}\`. Declarations in this file:\n${outline(lines)}`;
    const out: string[] = [];
    let previous = -2;
    for (const index of [...wanted].sort((a, b) => a - b).slice(0, 160)) {
      if (index !== previous + 1 && out.length > 0) out.push("      ...");
      out.push(...numbered(index, index + 1));
      previous = index;
    }
    return out.join("\n");
  }
  if (lines.length <= MAX_WHOLE_FILE) return numbered(0, lines.length).join("\n");
  return `${lines.length} lines; declarations only. Pass a member name for its body.\n${outline(lines)}`;
}

function outline(lines: readonly string[]): string {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /^\s*(@\w+\s+)*((public|internal|private|protected|open|abstract|final|data|sealed|expect|actual|inline|suspend|override|static|value|enum|annotation|fun|const)\s+)*(class|interface|object|fun|val|var|typealias)\b/.test(line),
    )
    .slice(0, 120)
    .map(({ line, index }) => `${String(index + 1).padStart(5)}  ${line.trim().slice(0, 170)}`)
    .join("\n");
}

function walk(directory: string, found: string[]): void {
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, name.name);
    if (name.isDirectory()) walk(path, found);
    else if (/\.(jar|aar)$/.test(name.name)) found.push(path);
  }
}

function listing(archive: string): string[] {
  const list = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return list.status === 0 ? list.stdout.split("\n").filter(Boolean) : [];
}

/** The classes inside an `.aar`, which keeps them in a nested `classes.jar`. */
function aarClasses(archive: string): { jar: string; entries: string[] } {
  const jar = join(WORK, "aar", `${basename(archive)}.classes.jar`);
  if (!existsSync(jar)) {
    mkdirSync(join(WORK, "aar"), { recursive: true });
    const inner = spawnSync("unzip", ["-p", archive, "classes.jar"], { maxBuffer: 256 * 1024 * 1024 });
    if (inner.status !== 0) return { jar, entries: [] };
    writeFileSync(jar, inner.stdout);
  }
  return { jar, entries: listing(jar) };
}

/** Every source and class file in the resolved dependencies, built once per sandbox. */
function dependencyIndex(cache: string): string[] {
  const archives: string[] = [];
  walk(cache, archives);
  const indexFile = join(WORK, "index.tsv");
  const stamp = join(WORK, "index.count");
  const version = `v2:${archives.length}`;
  if (existsSync(indexFile) && existsSync(stamp) && readFileSync(stamp, "utf8") === version)
    return readFileSync(indexFile, "utf8").split("\n").filter(Boolean);
  console.error(`[lib-source] indexing ${archives.length} dependency archives once; later calls are immediate`);
  const rows: string[] = [];
  for (const archive of archives) {
    if (archive.endsWith(".aar")) {
      // Indexed under the .aar itself, whose path carries the Maven coordinates.
      for (const entry of aarClasses(archive).entries)
        if (entry.endsWith(".class") && !entry.includes("$")) rows.push(`${archive}\t${entry}`);
      continue;
    }
    for (const entry of listing(archive))
      if (/\.(kt|java)$/.test(entry) || (entry.endsWith(".class") && !entry.includes("$"))) rows.push(`${archive}\t${entry}`);
  }
  mkdirSync(WORK, { recursive: true });
  writeFileSync(indexFile, rows.join("\n"));
  writeFileSync(stamp, version);
  return rows;
}

function fetchSources(at: Coordinates): string | null {
  const target = join(WORK, "sources", `${at.group}-${at.artifact}-${at.version}-sources.jar`);
  if (existsSync(target) && statSync(target).size > 0) return target;
  mkdirSync(join(WORK, "sources"), { recursive: true });
  for (const repository of REPOSITORIES) {
    const fetched = spawnSync("curl", ["-fsSL", "--max-time", "60", "-o", target, sourcesUrl(repository, at)]);
    if (fetched.status === 0 && existsSync(target) && statSync(target).size > 0) return target;
  }
  return null;
}

function printSource(archive: string, entry: string, member: string | null): void {
  const source = spawnSync("unzip", ["-p", archive, entry], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  console.log(`\n== ${entry}  (${basename(archive)})`);
  console.log(excerpt(source.stdout, member));
}

function main(name: string, member: string | null): number {
  const cache = join(process.env.GRADLE_USER_HOME ?? join(homedir(), ".gradle"), "caches/modules-2/files-2.1");
  if (!existsSync(cache)) {
    console.log(`No dependencies are resolved yet (${cache} is missing). Run a Gradle task first, for example: .sandcastle/agent/bin/gradle :shared:assembleAndroidMain`);
    return 1;
  }
  const { sources, classes } = entriesFor(dependencyIndex(cache), name);
  if (sources.length > 0) {
    for (const row of sources.slice(0, 3)) printSource(row.slice(0, row.indexOf("\t")), row.slice(row.indexOf("\t") + 1), member);
    return 0;
  }
  if (classes.length === 0) {
    console.log(`No resolved dependency has a class named \`${name}\`. It may be this repository's own code (use find-symbol), a Kotlin top-level function (search for the file's class, \`<File>Kt\`), or a dependency of a module no task has resolved yet.`);
    return 1;
  }
  const seen = new Set<string>();
  // A library's debug and release variants hold the same class: show it once.
  const distinct = classes.filter((row) => {
    const entry = row.slice(row.indexOf("\t") + 1);
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
  for (const row of distinct.slice(0, 3)) {
    const archive = row.slice(0, row.indexOf("\t"));
    const entry = row.slice(row.indexOf("\t") + 1);
    const original = coordinatesOf(archive);
    const sourcesJar = original === null ? null : fetchSources(original);
    const stem = entry.replace(/\.class$/, "").replace(/Kt$/, "");
    const inSources = sourcesJar === null ? [] : listing(sourcesJar).filter((file) => /\.(kt|java)$/.test(file) && basename(file).replace(/\.(kt|java)$/, "") === basename(stem));
    if (sourcesJar !== null && inSources.length > 0) {
      for (const file of inSources.slice(0, 2)) if (!seen.has(file)) printSource(sourcesJar, file, member);
      for (const file of inSources) seen.add(file);
      continue;
    }
    // No sources published: the compiled signatures are the next best thing.
    const fqcn = entry.replace(/\.class$/, "").replaceAll("/", ".");
    const classJar = archive.endsWith(".aar") ? aarClasses(archive).jar : archive;
    const signatures = spawnSync("javap", ["-p", "-cp", classJar, fqcn], { encoding: "utf8" });
    console.log(`\n== ${fqcn}  (${basename(archive)}; no sources jar, signatures from bytecode)`);
    console.log(signatures.stdout.trim() || signatures.stderr.trim());
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, member] = process.argv.slice(2);
  if (name === undefined || !/^[\w.$]+$/.test(name)) {
    console.log("usage: lib-source <Class or package.Class> [member]\n  e.g. lib-source StringDesc\n       lib-source dev.icerock.moko.resources.desc.ResourceFormattedStringDesc localized");
    process.exitCode = 2;
  } else process.exitCode = main(name, member ?? null);
}
