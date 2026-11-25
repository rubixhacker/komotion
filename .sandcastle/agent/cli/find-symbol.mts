/**
 * Where a name is declared and used: `.sandcastle/agent/bin/find-symbol <Name>`.
 *
 * An author made a median of 62 tool calls before its first edit, most of them
 * `grep -rn`, `find` and `sed -n` over one name at a time, and the Swift side
 * of a Kotlin change was the part most often missed. One call here answers
 * what those calls pieced together: the declarations, then every file that
 * uses the name, grouped by the part of the repository it is in, with the
 * Swift call sites shown in full because they are what a Kotlin change breaks.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCES = ["*.kt", "*.kts", "*.swift", "*.xml", "*.mob"];
const DECLARATION =
  /\b(class|interface|object|fun|val|var|typealias|struct|protocol|func|let|extension|enum|case|actor)\s+(<[^>]*>\s*)?([\w.]+\.)?/;
const MAX_LINES_PER_GROUP = 12;

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** `git grep -n` output as hits. */
export function parseHits(output: string): Hit[] {
  const hits: Hit[] = [];
  for (const row of output.split("\n")) {
    const match = /^([^:]+):(\d+):(.*)$/.exec(row);
    if (match === null) continue;
    hits.push({ file: match[1] ?? "", line: Number(match[2]), text: (match[3] ?? "").trim() });
  }
  return hits;
}

export function isDeclaration(text: string, name: string): boolean {
  const match = DECLARATION.exec(text);
  if (match === null) return false;
  const rest = text.slice(match.index + match[0].length);
  return rest.startsWith(name) && !/[\w]/.test(rest.charAt(name.length));
}

/** The part of the repository a file belongs to, as an agent thinks of it. */
export function areaOf(file: string): string {
  const test = /(Test|Tests)\b|\/(androidHostTest|commonTest|iosTest|test|androidTest)\//.test(file);
  const parts = file.split("/");
  let area: string;
  if (parts[0] === "shared" && parts.length > 4) area = parts.slice(0, 4).join("/");
  else if (parts[0] === "iosApp" && parts.length > 2) area = parts.slice(0, 2).join("/");
  else area = parts[0] ?? file;
  return test ? `${area} (tests)` : area;
}

/** The report for `name`, from every line of the repository that mentions it. */
export function describe(name: string, hits: readonly Hit[]): string {
  if (hits.length === 0)
    return `No source file mentions \`${name}\`. Check the spelling; a Kotlin name can differ in Swift (see the kotlin-to-swift skill).`;
  const declarations = hits.filter((hit) => isDeclaration(hit.text, name));
  const uses = hits.filter((hit) => !isDeclaration(hit.text, name));
  const out: string[] = [];
  out.push(`${name}: ${declarations.length} declaration(s), ${uses.length} use(s) in ${new Set(uses.map((hit) => hit.file)).size} file(s).`);
  if (declarations.length > 0) {
    out.push("", "Declared:");
    for (const hit of declarations.slice(0, 20)) out.push(`  ${hit.file}:${hit.line}: ${hit.text.slice(0, 160)}`);
  }
  const groups = new Map<string, Hit[]>();
  for (const hit of uses) {
    const area = areaOf(hit.file);
    groups.set(area, [...(groups.get(area) ?? []), hit]);
  }
  // Swift first: it is the side no Gradle check compiles.
  const order = [...groups.keys()].sort(
    (a, b) => Number(b.startsWith("iosApp")) - Number(a.startsWith("iosApp")) || a.localeCompare(b),
  );
  for (const area of order) {
    const group = groups.get(area) ?? [];
    out.push("", `${area}: ${group.length} use(s)`);
    for (const hit of group.slice(0, MAX_LINES_PER_GROUP))
      out.push(`  ${hit.file}:${hit.line}: ${hit.text.slice(0, 160)}`);
    if (group.length > MAX_LINES_PER_GROUP) {
      const files = [...new Set(group.slice(MAX_LINES_PER_GROUP).map((hit) => hit.file))];
      out.push(`  ... and ${group.length - MAX_LINES_PER_GROUP} more in: ${files.slice(0, 8).join(", ")}`);
    }
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2] ?? "";
  if (!/^[A-Za-z_][\w.]*$/.test(name)) {
    console.log("usage: find-symbol <Name>   (one Kotlin or Swift name, or a string key such as workflow_error_unknown)");
    process.exitCode = 2;
  } else {
    const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
    const grep = spawnSync(
      "git",
      ["grep", "-n", "-w", "-F", "--no-color", "--untracked", name, "--", ...SOURCES, ":!.sandcastle"],
      { cwd: root || process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    console.log(describe(name, parseHits(grep.stdout)));
  }
}
