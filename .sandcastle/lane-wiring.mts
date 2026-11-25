import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The lane manifest is the one definition of a scheduled lane. These checks
// keep the surfaces that still live in tracked files (package scripts, lane
// docs, README rows) in step with it, and keep the wrapper and installer
// reading it instead of growing their own lane lists again.

export interface ReadmeDefinition {
  title: string | undefined;
  entry: string | undefined;
  writesTo: string | undefined;
}

export interface LaneDefinition {
  name: string | undefined;
  entry: string | undefined;
  interval: number | undefined;
  runAtLoad: boolean | undefined;
  watchPath: string | null | undefined;
  doc: string | undefined;
  packageScript: string | undefined;
  checkScript: string | null | undefined;
  readme: ReadmeDefinition | undefined;
}

export interface LaneManifest {
  lanes: LaneDefinition[] | undefined;
}

export interface WiringSurfaces {
  wrapper: string;
  installer: string;
  readme: string;
  packageJson: string;
  template: string;
  entries: readonly string[];
  docs: readonly string[];
}

// Services have their own plist templates and no wrapper entry or npm script.
const services = new Set(["review-server", "dispatch-runner"]);
const serviceDocs = new Set(["review-server.md"]);
const laneName = /^[a-z][a-z0-9-]*$/;
const watchPath = /^[A-Za-z0-9._/-]+$/;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseLaneManifest(text: string): LaneManifest {
  const value: unknown = JSON.parse(text);
  const root = asObject(value);
  if (root === undefined || !Array.isArray(root.lanes)) {
    throw new Error("lane manifest must have a lanes array");
  }
  return { lanes: root.lanes as LaneDefinition[] };
}

function packageScripts(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text);
  const root = asObject(value);
  const scripts = root?.scripts;
  if (root === undefined || scripts === undefined) return {};
  const entries = asObject(scripts);
  if (entries === undefined) return {};
  const result: Record<string, string> = {};
  for (const [name, command] of Object.entries(entries)) {
    if (typeof command === "string") result[name] = command;
  }
  return result;
}

function readmeRows(readme: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of readme.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    for (const cell of cells) {
      const agent = cell.replaceAll("`", "").match(/^com\.rubixhacker\.sandcastle\.([a-z0-9-]+)$/);
      if (agent?.[1] !== undefined) {
        rows.set(agent[1], cells);
        break;
      }
    }
  }
  return rows;
}

export function laneWiringProblems(manifest: LaneManifest, surfaces: WiringSurfaces): string[] {
  const problems: string[] = [];
  const need = (condition: boolean, message: string): void => {
    if (!condition) problems.push(message);
  };
  const lanes = manifest.lanes ?? [];
  const scripts = packageScripts(surfaces.packageJson);
  const rows = readmeRows(surfaces.readme);
  const definedNames = new Set<string>();
  const definedDocs = new Set<string>();

  // These two scripts must not grow another lane list: an installed host reads
  // the manifest on every install and every lane run.
  need(
    surfaces.installer.includes("lanes/manifest.json"),
    "the installer does not read lanes/manifest.json",
  );
  need(
    !/\blabels=\(factory\b/.test(surfaces.installer),
    "the installer still has a hard-coded lane array",
  );
  need(
    surfaces.wrapper.includes("lanes/manifest.json"),
    "the lane wrapper does not read lanes/manifest.json",
  );
  need(
    !/\bfactory\|dependabot\b/.test(surfaces.wrapper),
    "the lane wrapper still has a hard-coded lane allowlist",
  );
  for (const placeholder of ["__LANE__", "__INTERVAL__", "__RUNATLOAD__", "__WATCHPATHS__"]) {
    need(surfaces.template.includes(placeholder), `the plist template no longer has ${placeholder}`);
  }

  for (const lane of lanes) {
    const name = lane.name ?? "<unnamed>";
    if (lane.name === undefined || !laneName.test(lane.name)) {
      problems.push(`lane "${name}" has an invalid name`);
      continue;
    }
    need(!definedNames.has(name), `lane "${name}" is defined twice`);
    definedNames.add(name);

    // An entry is the wrapper's entry point, the .mts file and the npm scripts.
    if (lane.entry === undefined || !laneName.test(lane.entry)) {
      problems.push(`lane "${name}" has no entry`);
    } else {
      need(
        surfaces.entries.includes(`${lane.entry}.mts`),
        `entry file .sandcastle/${lane.entry}.mts for lane "${name}" is missing`,
      );
      need(
        scripts[lane.packageScript ?? ""] === `tsx ${lane.entry}.mts`,
        `lane "${name}" has no ${lane.packageScript ?? ""} package script`,
      );
      if (lane.checkScript !== undefined && lane.checkScript !== null) {
        need(
          scripts[lane.checkScript] === `tsx ${lane.entry}.mts --check`,
          `lane "${name}" has no ${lane.checkScript} package script`,
        );
      }
    }

    const docPath = lane.doc ?? "";
    need(
      docPath.startsWith("lanes/") && surfaces.docs.includes(basename(docPath)),
      `lane "${name}" has no doc ${lane.doc ?? "<none>"}`,
    );
    if (docPath.length > 0) definedDocs.add(basename(docPath));

    // The installer slot is the timing and wake data the plist template renders.
    // A null interval is an event-driven lane: the installer renders no
    // StartInterval key, leaving RunAtLoad and WatchPaths as the only wakes.
    need(
      lane.interval === null ||
        (typeof lane.interval === "number" && Number.isInteger(lane.interval) && lane.interval > 0),
      `lane "${name}" has no installer slot: interval is missing or invalid`,
    );
    need(
      typeof lane.runAtLoad === "boolean",
      `lane "${name}" has no installer slot: runAtLoad is missing`,
    );
    need(
      lane.watchPath !== undefined &&
        (lane.watchPath === null || (lane.watchPath.length > 0 && watchPath.test(lane.watchPath))),
      `lane "${name}" has no installer slot: watchPath is missing or invalid`,
    );

    const row = rows.get(name);
    if (row === undefined) {
      problems.push(`lane "${name}" has no README row`);
    } else {
      const readme = lane.readme;
      if (readme === undefined) {
        problems.push(`lane "${name}" has no README definition`);
      } else {
        need(row[1] === readme.title, `README row for "${name}" has the wrong title`);
        need(
          row[2]?.replaceAll("`", "") === readme.entry,
          `README row for "${name}" has the wrong entry point`,
        );
        need(row[4] === readme.writesTo, `README row for "${name}" has the wrong write target`);
        const link = lane.doc ?? "";
        need(row[5] === `[${link}](${link})`, `README row for "${name}" links to the wrong doc`);
      }
    }
  }

  // The other direction: a surface that names a lane the manifest does not
  // define is the half-wired lane the gate exists to catch.
  for (const name of rows.keys()) {
    if (!definedNames.has(name) && !services.has(name)) {
      problems.push(`lane "${name}" has no definition (README row)`);
    }
  }
  for (const doc of surfaces.docs) {
    if (!definedDocs.has(doc) && !serviceDocs.has(doc)) {
      problems.push(`lane doc "${doc}" has no definition`);
    }
  }
  return problems;
}

export function laneWiringProblemsForRoot(root: string): string[] {
  const sandcastle = join(root, ".sandcastle");
  return laneWiringProblems(
    parseLaneManifest(readFileSync(join(sandcastle, "lanes/manifest.json"), "utf8")),
    {
      installer: readFileSync(join(root, "scripts/install-sandcastle-macos.sh"), "utf8"),
      wrapper: readFileSync(join(root, "scripts/ci/sandcastle-lane.sh"), "utf8"),
      readme: readFileSync(join(sandcastle, "README.md"), "utf8"),
      packageJson: readFileSync(join(sandcastle, "package.json"), "utf8"),
      template: readFileSync(
        join(sandcastle, "launchd/com.rubixhacker.sandcastle.LANE.plist.template"),
        "utf8",
      ),
      entries: readdirSync(sandcastle).filter((name) => name.endsWith(".mts")),
      docs: readdirSync(join(sandcastle, "lanes")).filter((name) => name.endsWith(".md")),
    },
  );
}

export function verifyLaneWiring(root: string): void {
  const problems = laneWiringProblemsForRoot(root);
  if (problems.length > 0) {
    throw new Error(`lane wiring is inconsistent:\n- ${problems.join("\n- ")}`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyLaneWiring(resolve(fileURLToPath(new URL("../", import.meta.url))));
  console.log("lane wiring: OK");
}
