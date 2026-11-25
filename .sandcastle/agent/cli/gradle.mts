/**
 * The one way a factory agent runs Gradle: `.sandcastle/agent/bin/gradle <tasks>`.
 *
 * Raw `./gradlew` is denied in the sandbox (`opencode.json`). In the 601 agent
 * sessions up to 15 November Gradle was 74% of all tool time, and one run in
 * five repeated a command on files that had not changed since it last ran:
 * 12 hours. Agents also set seven different GRADLE_USER_HOME values, each a
 * cold dependency cache, started builds in the background, and sat silent on a
 * hung build until the factory stopped the run.
 *
 * This runs one foreground build with the image's own environment, keeps the
 * whole log in a file, prints only the result and what failed, answers a
 * repeated command on unchanged files from its earlier result, and stops a
 * build before the factory's silence limit.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Below the factory's 30-minute silence limit, so a hung build comes back as a diagnosis. */
export const DEFAULT_MINUTES = 25;
const MAX_SUMMARY = 6000;
/** Variables an agent sets to "fix" Gradle; each one starts a second, cold cache. */
const DROPPED_ENV = ["GRADLE_USER_HOME", "ANDROID_USER_HOME", "JAVA_TOOL_OPTIONS"];

/** Why these arguments are refused, or null when they may run. */
export function refusal(words: readonly string[]): string | null {
  if (words.length === 0) return "name at least one task, for example `qualityGate`";
  for (const word of words) {
    if (/[;&|<>`]|\$\(/.test(word))
      return `\`${word}\` is shell syntax; pass Gradle tasks and flags only`;
    if (word === "--daemon" || word === "--continuous" || word === "-t")
      return `\`${word}\` leaves a process running; a factory build is one foreground build`;
    if (word === "-x" || word === "--exclude-task")
      return "excluding a task hides its findings; run the task and fix what it reports";
    if (/^-P.*(baseline|ignoreFailures)/i.test(word))
      return `\`${word}\` relaxes a check; fix the finding instead`;
    if (/(^|:)(detektBaseline\w*|updateLintBaseline)$/i.test(word))
      return "regenerating a baseline hides findings; fix them instead";
  }
  return null;
}

/** The lines of a Gradle log an agent needs: what failed and why, not the task list. */
export function summarize(log: string): string {
  const lines = log.split("\n");
  const keep = new Set<number>();
  const add = (from: number, count: number): void => {
    for (let index = from; index < Math.min(lines.length, from + count); index += 1) keep.add(index);
  };
  lines.forEach((line, index) => {
    if (/^e: /.test(line)) add(index, 1);
    else if (/^> Task .* FAILED$/.test(line)) add(index, 1);
    else if (/ FAILED$/.test(line)) add(index, 8);
    else if (/^\* What went wrong:/.test(line)) {
      const end = lines.findIndex((later, at) => at > index && later.startsWith("* Try:"));
      add(index, Math.min(end === -1 ? 14 : end - index, 14));
    }
    else if (/^(FAILURE:|BUILD (SUCCESSFUL|FAILED))/.test(line)) add(index, 1);
    else if (/\.(kt|kts|swift|xml|java):\d+(:\d+)?:? /.test(line)) add(index, 1);
    else if (/format violations|spotlessApply|tests completed/.test(line)) add(index, 4);
    else if (/OutOfMemoryError|Java heap space|No space left|daemon disappeared/.test(line))
      add(index, 2);
  });
  const text = [...keep]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join("\n");
  return text.length > MAX_SUMMARY
    ? `${text.slice(0, MAX_SUMMARY)}\n[${text.length - MAX_SUMMARY} more characters are in the log file]`
    : text;
}

function git(directory: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : "";
}

/** A name for the exact sources a build sees: the commit and every uncommitted change. */
export function treeFingerprint(directory: string): string {
  const hash = createHash("sha256");
  hash.update(git(directory, ["rev-parse", "HEAD"]));
  hash.update(git(directory, ["diff", "HEAD", "--", ".", ":!.sandcastle"]));
  const untracked = git(directory, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ".",
    ":!.sandcastle",
  ]);
  for (const file of untracked.split("\n")) {
    if (file === "") continue;
    hash.update(file);
    try {
      hash.update(readFileSync(join(directory, file)));
    } catch {
      // A file that vanished since the listing still changes the name by its path.
    }
  }
  return hash.digest("hex");
}

export interface BuildResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly seconds: number;
  readonly log: string;
}

/** What the agent is told about one build. `repeated` is a result reused from an earlier run. */
export function report(
  result: BuildResult,
  words: readonly string[],
  logFile: string,
  repeated: boolean,
): string {
  const outcome = result.timedOut
    ? `TIMED OUT after ${Math.round(result.seconds / 60)} minutes and was stopped`
    : result.exitCode === 0
      ? `PASSED in ${result.seconds} s`
      : `FAILED (exit ${result.exitCode}) in ${result.seconds} s`;
  const parts = [`gradle ${words.join(" ")}: ${outcome}.`];
  if (repeated)
    parts.push(
      "NOT RUN AGAIN: no file has changed since this exact command last ran, so the result is the same.",
      result.exitCode === 0
        ? "It passed and still passes. Go on to the next step."
        : "Change the code or run a different task. Add --rerun only when the failure below is the machine's (out of memory, a network error) and not the code's.",
    );
  if (result.timedOut) {
    const tasks = result.log.split("\n").filter((line) => line.startsWith("> Task "));
    parts.push(
      `Last task started: ${tasks.at(-1) ?? "(none)"}.`,
      "Do not run the same command again. Run the one task or test class that hung, with a --tests filter, and record the hang in delivery.md if it repeats.",
    );
  }
  const summary = summarize(result.log);
  if (summary !== "" && (result.exitCode !== 0 || result.timedOut)) parts.push(summary);
  parts.push(`Full log: ${logFile} (search it with grep; do not print it whole).`);
  return parts.join("\n");
}

function build(
  directory: string,
  words: readonly string[],
  minutes: number,
): Promise<BuildResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const child = spawn("./gradlew", ["--no-daemon", "--console=plain", ...words], {
      cwd: directory,
      // Its own process group, so a timeout stops the workers Gradle forked too.
      detached: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !DROPPED_ENV.includes(name)),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, minutes * 60_000);
    // A line every few minutes: a long build is not a silent agent.
    const heartbeat = setInterval(() => {
      const tasks = Buffer.concat(chunks).toString("utf8").split("\n");
      const last = tasks.filter((line) => line.startsWith("> Task ")).at(-1) ?? "starting";
      process.stderr.write(`[gradle] ${Math.round((Date.now() - started) / 60_000)} min: ${last}\n`);
    }, 180_000);
    const finish = (exitCode: number): void => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      resolve({
        exitCode,
        timedOut,
        seconds: Math.round((Date.now() - started) / 1000),
        log: Buffer.concat(chunks).toString("utf8"),
      });
    };
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      chunks.push(Buffer.from(`\n${String(error)}\n`));
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

export interface GradleOptions {
  readonly directory: string;
  readonly stateDirectory: string;
  /** Runs the build; tests replace it. */
  readonly run?: (directory: string, words: readonly string[], minutes: number) => Promise<BuildResult>;
}

/** Run `argv` as Gradle arguments and return the text for the agent and the exit code. */
export async function gradle(
  argv: readonly string[],
  options: GradleOptions,
): Promise<{ readonly text: string; readonly exitCode: number }> {
  const rerun = argv.includes("--rerun");
  const words = argv.filter(
    (word, index) =>
      word !== "--rerun" &&
      word !== "--no-daemon" &&
      !word.startsWith("--console") &&
      !(index === 0 && /(^|\/)gradlew$/.test(word)),
  );
  const refused = refusal(words);
  if (refused !== null) return { text: `Refused: ${refused}.`, exitCode: 2 };
  if (!existsSync(join(options.directory, "gradlew")))
    return { text: `Refused: ${options.directory} has no gradlew; run this from the repository root.`, exitCode: 2 };

  mkdirSync(options.stateDirectory, { recursive: true });
  const key = createHash("sha256")
    .update(JSON.stringify(words))
    .update(treeFingerprint(options.directory))
    .digest("hex")
    .slice(0, 24);
  const resultFile = join(options.stateDirectory, `${key}.json`);
  const logFile = join(options.stateDirectory, `${key}.log`);
  // Formatting changes the files by design, so its result is never reused.
  const reusable = !words.some((word) => /spotlessApply$/.test(word));
  if (reusable && !rerun && existsSync(resultFile) && existsSync(logFile)) {
    const earlier = JSON.parse(readFileSync(resultFile, "utf8")) as Omit<BuildResult, "log">;
    const result = { ...earlier, log: readFileSync(logFile, "utf8") };
    return { text: report(result, words, logFile, true), exitCode: result.exitCode };
  }
  const result = await (options.run ?? build)(options.directory, words, DEFAULT_MINUTES);
  writeFileSync(logFile, result.log);
  if (reusable && !result.timedOut)
    writeFileSync(
      resultFile,
      JSON.stringify({ exitCode: result.exitCode, timedOut: false, seconds: result.seconds }),
    );
  return {
    text: report(result, words, logFile, false),
    exitCode: result.timedOut ? 124 : result.exitCode,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim() || process.cwd();
  const outcome = await gradle(process.argv.slice(2), {
    directory: root,
    stateDirectory: process.env.SANDCASTLE_GRADLE_STATE ?? "/tmp/sandcastle-gradle",
  });
  console.log(outcome.text);
  process.exitCode = outcome.exitCode;
}
