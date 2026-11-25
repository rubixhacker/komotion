/**
 * Reusable, event-driven CI repair for the factory's own pull requests.
 *
 * The factory's periodic sweep used to read each failing pull request, decide
 * what to do with it and carry the rebase/repair/escalation out inline. That
 * meant the only way to repair a red pull request was to run a whole factory
 * pass. This module is that work as one callable unit: a GitHub event (a CI
 * failure, or a push to main that creates a conflict) can repair the affected
 * pull request in seconds, and the factory's sweep calls the same unit instead
 * of keeping a second copy of the logic.
 *
 * An event carries no facts: every decision here starts with a fresh read of
 * GitHub. The sandboxed repair itself still lives in the factory, because it
 * needs the host's credential and the reviewed repair pipeline; the CLI hands
 * the decided action to `main.mts --ci-repair-perform <pr>`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CiAttemptMarks } from "./ci-attempt-marks.mjs";
import { flakyFailure } from "./ci-flake.mjs";
import {
  checkRepairMark,
  planCiSweep,
  type SweepAction,
  type SweepEntry,
} from "./ci-sweep.mjs";
import { failingChecks, failingRunIds } from "./factory-ci.mjs";
import {
  FACTORY_PR_JSON_FIELDS,
  ListedFactoryPr,
  selectFailedFactoryPrs,
} from "./factory-prs.mjs";
import { mapLimit } from "./map-limit.mjs";
import { alertOperator } from "./operator-alert.mjs";
import { failingTestNames, targetedRepairContext } from "./targeted-repair.mjs";

/** The pull requests a sweep needs to act on, with the issue each one delivers. */
export type FailedPr = {
  readonly pr: ListedFactoryPr;
  readonly issue: number;
  readonly conflict: boolean;
};

/** The ledgers that give each head one repair and one escalation. */
export type CiRepairPaths = {
  readonly attempts: string;
  readonly alerts: string;
  readonly targeted: string;
  readonly flakeReruns: string;
};

/**
 * Everything the decision and its action need from the host. The factory
 * supplies its own functions; the CLI supplies the same behaviour against the
 * host checkout. Keeping the host behind this interface is what lets the
 * factory's sweep and the event-driven CLI share one implementation.
 */
export interface CiRepairHost {
  readonly paths: CiRepairPaths;
  readonly listFactoryPrs: () => ListedFactoryPr[];
  readonly readFactoryPr: (prNumber: number) => ListedFactoryPr;
  readonly readHeads: (path: string) => ReadonlySet<string>;
  readonly recordHead: (path: string, head: string) => void;
  readonly alert: (message: string) => void;
  readonly log: (message: string) => void;
  /** The failing job log, read on the host: a sandbox has no GitHub credential. */
  readonly failingContext: (branch: string) => Promise<string>;
  readonly contractHints: (tests: readonly string[]) => string[];
  readonly rerunFailed: (pr: ListedFactoryPr) => void;
  /** Rebase a conflict or repair a check, then re-review, re-gate and push. */
  readonly repair: (
    pr: ListedFactoryPr,
    issue: number,
    conflict: boolean,
    context?: string,
  ) => Promise<void>;
  readonly marks: Pick<CiAttemptMarks, "run">;
  readonly concurrency: number;
}

/**
 * Turn a GitHub pull request into the sweep's decision input. A request that
 * has no failing check and no conflict needs no repair, and neither does a
 * pull request the factory does not own or that names no issue branch.
 */
export function entryFromPr(pr: ListedFactoryPr): SweepEntry | null {
  const conflict = pr.mergeable === "CONFLICTING";
  if (failingChecks(pr).length === 0 && !conflict) return null;
  if (pr.state !== "OPEN" || pr.baseRefName !== "main" || pr.isDraft || pr.isCrossRepository)
    return null;
  const match = /^sandcastle\/issue-(\d+)$/.exec(pr.headRefName);
  if (match === null) return null;
  return { prNumber: pr.number, issue: Number(match[1]), head: pr.headRefOid, conflict };
}

/** Decide one pull request's action from the current ledger state. */
export function planPrRepair(entry: SweepEntry, host: CiRepairHost): SweepAction {
  const repaired = host.readHeads(host.paths.attempts);
  const alerted = host.readHeads(host.paths.alerts);
  const [action] = planCiSweep([entry], repaired, alerted);
  // planCiSweep returns exactly one action for one entry.
  if (action === undefined) throw new Error("planCiSweep returned no action");
  return action;
}

/** Read a factory pull request by its number, with the fields the sweep uses. */
export function readPrFromGitHub(
  prNumber: number,
  command: (program: string, args: readonly string[]) => string,
): ListedFactoryPr {
  return ListedFactoryPr.parse(
    JSON.parse(
      command("gh", [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        "rubixhacker/komotion",
        "--json",
        FACTORY_PR_JSON_FIELDS,
      ]),
    ),
  );
}

/** Carry out the action `planCiSweep` chose for one pull request. */
async function performAction(
  action: SweepAction,
  pr: ListedFactoryPr,
  host: CiRepairHost,
): Promise<void> {
  if (action.kind === "skip") return;
  if (action.kind === "escalate") {
    // Before asking a human, spend one targeted attempt whose brief names the
    // failing tests and the contracts that govern them. The key is per head,
    // so a later push gets its own chance.
    if (!action.conflict) {
      const key = `targeted:${action.prNumber}:${action.head}`;
      if (!host.readHeads(host.paths.targeted).has(key)) {
        host.recordHead(host.paths.targeted, key);
        const failure = await host.failingContext(pr.headRefName);
        const tests = failingTestNames(failure);
        const docs = host.contractHints(tests);
        host.log(
          `#${action.prNumber}: targeted second repair (${tests.length} test(s), ${docs.length} contract file(s)).`,
        );
        try {
          await host.repair(pr, action.issue, false, targetedRepairContext(failure, { tests, docs }));
        } catch (error) {
          host.log(`#${action.prNumber}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
    }
    host.recordHead(host.paths.alerts, action.key);
    const message = `factory pull request #${action.prNumber} (issue #${action.issue}) still ${action.conflict ? "conflicts with main" : "fails its checks"} at ${action.head.slice(0, 7)}; it needs a human`;
    host.log(`#${action.prNumber}: ${message}.`);
    host.alert(message);
    return;
  }
  // A known-flaky failure is re-run once before a repair agent is spent on it,
  // so a flake never consumes the head's one repair or a sandbox.
  if (action.kind === "repair" && !action.conflict) {
    const flakeKey = `flake:${action.prNumber}:${action.head}`;
    if (!host.readHeads(host.paths.flakeReruns).has(flakeKey)) {
      const signature = flakyFailure(await host.failingContext(pr.headRefName));
      if (signature !== null) {
        host.recordHead(host.paths.flakeReruns, flakeKey);
        host.log(`#${action.prNumber}: ${signature}; re-running the failed jobs before a repair.`);
        host.rerunFailed(pr);
        return;
      }
    }
  }
  // Record before repairing: a repair that crashes still spends the head's
  // attempt, so a broken repair cannot loop on every event or sweep.
  const marks = [action.attemptMark];
  if (action.kind === "repair") marks.push(checkRepairMark(action.prNumber, action.head));
  host.log(`#${action.prNumber}: ${action.kind} attempt for head ${action.head.slice(0, 7)}.`);
  await host.marks.run(marks, () => host.repair(pr, action.issue, action.conflict));
}

/**
 * Decide and perform every pulled request's action. The factory's sweep and
 * the event-driven CLI both enter here, so a repair made from an event follows
 * exactly the same path as one made from a timer.
 */
export async function runCiRepairEntries(
  failed: readonly FailedPr[],
  host: CiRepairHost,
): Promise<SweepAction[]> {
  const actions = failed.map(({ pr, issue, conflict }) =>
    planPrRepair(
      {
        prNumber: pr.number,
        issue,
        head: pr.headRefOid,
        conflict,
      },
      host,
    ),
  );
  const byNumber = new Map(failed.map(({ pr }) => [pr.number, pr]));
  const tasks: Array<{ action: SweepAction; pr: ListedFactoryPr }> = [];
  for (const action of actions) {
    const pr = byNumber.get(action.prNumber);
    if (pr !== undefined) tasks.push({ action, pr });
  }
  await mapLimit(tasks, host.concurrency, async ({ action, pr }) => {
    try {
      await performAction(action, pr, host);
    } catch (error) {
      host.log(`#${action.prNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return actions;
}

/** Repair one pull request end to end, from a fresh read of GitHub. */
export async function runCiRepair(
  prNumber: number,
  host: CiRepairHost,
): Promise<SweepAction | null> {
  const pr = host.readFactoryPr(prNumber);
  const entry = entryFromPr(pr);
  if (entry === null) {
    host.log(`#${prNumber}: no failing check or conflict on a factory issue branch; nothing to repair.`);
    return null;
  }
  const actions = await runCiRepairEntries(
    [{ pr, issue: entry.issue, conflict: entry.conflict }],
    host,
  );
  return actions[0] ?? null;
}

/** Read a head ledger, e.g. the resume-attempts or ci-alerts file. */
export function readHeads(path: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Append one mark to a head ledger. */
export function recordHead(path: string, head: string): void {
  const heads = readHeads(path);
  heads.add(head);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify([...heads].slice(-200), null, 2)}\n`);
}

/**
 * Thrown when the detached repair worker exited without acknowledging that it
 * reached its repair branch. The CLI must not spend the head's attempt in that
 * case: no rebase or repair ran, so the next event is free to try again.
 */
export class CiRepairWorkerNotStartedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CiRepairWorkerNotStartedError";
  }
}

/**
 * The CLI's attempt-mark policy. A factory pass calls `CiAttemptMarks.run`,
 * which records marks before its in-process repair so a crash spends the head.
 * The CLI cannot do that: it starts a separate worker that may never start at
 * all (a spawn failure, lock contention or a stale-head refusal). It waits for
 * the worker's start acknowledgement and only then records the marks; a worker
 * that did start and then failed still spends the attempt.
 */
export function workerMarksRun(
  marksPath: string,
  record: (path: string, head: string) => void = recordHead,
): CiAttemptMarks["run"] {
  const recordAll = (marks: readonly string[]): void => {
    for (const mark of marks) record(marksPath, mark);
  };
  return async (marks, work) => {
    try {
      const result = await work();
      recordAll(marks);
      return result;
    } catch (error) {
      if (error instanceof CiRepairWorkerNotStartedError) throw error;
      recordAll(marks);
      throw error;
    }
  };
}

/** The failing checks' own logs, fetched on the host. */
export async function failingCheckContext(pr: ListedFactoryPr): Promise<string> {
  const failing = failingChecks(pr);
  if (failing.length === 0) return `No failing check is reported on PR #${pr.number}.`;
  const lines: string[] = [`Failing checks on PR #${pr.number}:`];
  for (const check of failing) {
    const name = check.name ?? check.context ?? "(unnamed)";
    lines.push(`- ${name}: ${check.conclusion ?? check.state ?? "failed"}`);
  }
  for (const run of failingRunIds(pr)) {
    const log = spawnSync("gh", ["run", "view", run, "--repo", "rubixhacker/komotion", "--log-failed"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (log.status === 0 && log.stdout.trim()) {
      lines.push(`\n=== failed log for run ${run} ===`, log.stdout.trim());
    } else {
      lines.push(`\n=== failed log for run ${run} is unavailable ===\n${log.stderr?.trim() ?? ""}`);
    }
  }
  return lines.join("\n");
}

/** Contract, ADR and test files that mention failing test names. */
export function contractHintsFor(
  tests: readonly string[],
  command: (program: string, args: readonly string[]) => string,
): string[] {
  const found = new Set<string>();
  for (const name of tests.slice(0, 5)) {
    let hits: string;
    try {
      hits = command("git", ["grep", "-l", name, "HEAD", "--", "shared", "iosApp", "androidApp"]);
    } catch {
      continue;
    }
    for (const hit of hits.split("\n")) {
      const file = hit.replace(/^HEAD:/, "");
      if (!/\.(kt|swift|json|md)$/.test(file)) continue;
      found.add(file);
      try {
        const body = command("git", ["show", `HEAD:${file}`]);
        for (const ref of body.matchAll(/(?:docs\/adr\/|contracts\/)[^\s"'`)]+/g)) found.add(ref[0] ?? "");
      } catch {
        // A file that disappeared from HEAD is still a useful hint itself.
      }
    }
  }
  return [...found].filter((file) => file !== "").slice(0, 12);
}

/** Re-run the failed jobs of a pull request's failing workflow runs. */
export function rerunFailedChecks(
  pr: ListedFactoryPr,
  command: (program: string, args: readonly string[]) => string,
): void {
  for (const run of failingRunIds(pr)) {
    try {
      command("gh", ["run", "rerun", run, "--repo", "rubixhacker/komotion", "--failed"]);
      console.log(`#${pr.number}: re-running the failed jobs of run ${run}.`);
    } catch (error) {
      console.error(`#${pr.number}: run ${run} could not be re-run: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The host used when this module runs as `npm run ci-repair -- <pr>`. */
function cliHost(root: string): CiRepairHost {
  const command = (program: string, args: readonly string[]): string =>
    execFileSync(program, [...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  const logs = resolve(root, ".sandcastle/logs");
  const listFactoryPrs = (): ListedFactoryPr[] =>
    zParsePrs(command("gh", ["pr", "list", "--repo", "rubixhacker/komotion", "--state", "open", "--limit", "200", "--json", FACTORY_PR_JSON_FIELDS]));
  return {
    paths: {
      attempts: resolve(logs, "resume-attempts.json"),
      alerts: resolve(logs, "ci-alerts.json"),
      targeted: resolve(logs, "targeted-repairs.json"),
      flakeReruns: resolve(logs, "flake-reruns.json"),
    },
    listFactoryPrs,
    readFactoryPr: (prNumber) => readPrFromGitHub(prNumber, command),
    readHeads,
    recordHead,
    alert: (message) => alertOperator(root, message),
    log: (message) => console.log(message),
    failingContext: (branch) => {
      const pr = ListedFactoryPr.parse(
        JSON.parse(
          command("gh", ["pr", "view", branch, "--repo", "rubixhacker/komotion", "--json", FACTORY_PR_JSON_FIELDS]),
        ),
      );
      return failingCheckContext(pr);
    },
    contractHints: (tests) => contractHintsFor(tests, command),
    rerunFailed: (pr) => rerunFailedChecks(pr, command),
    repair: async (pr, _issue, conflict, context) => {
      // A CI log does not fit in argv, so a targeted brief travels as a file.
      const contextFile = resolve(root, `.sandcastle/logs/ci-repair-context-${pr.number}.txt`);
      // The worker writes this only after it has taken the lease and passed its
      // head guard. Its absence is how the CLI knows the repair never began.
      const startedFile = resolve(root, `.sandcastle/logs/ci-repair-started-${pr.number}.txt`);
      rmSync(startedFile, { force: true });
      if (context !== undefined) {
        mkdirSync(dirname(contextFile), { recursive: true });
        writeFileSync(contextFile, context);
      }
      const args = [
        resolve(root, ".sandcastle/node_modules/tsx/dist/cli.mjs"),
        resolve(root, ".sandcastle/main.mts"),
        "--ci-repair-perform",
        String(pr.number),
        // The event may be stale; the worker must repair the head the decision
        // was made on, or one that moved in between gets overwritten.
        "--ci-repair-head",
        pr.headRefOid,
        ...(conflict ? ["--conflict"] : []),
        ...(context !== undefined ? ["--ci-repair-context", contextFile] : []),
        "--ci-repair-started",
        startedFile,
      ];
      const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
      if (!existsSync(startedFile)) {
        const detail = result.error?.message ?? `status ${String(result.status)}`;
        throw new CiRepairWorkerNotStartedError(
          `#${pr.number}: CI repair worker never started (${detail})`,
        );
      }
      if (result.status !== 0)
        throw new Error(`CI repair worker exited with status ${String(result.status)}`);
    },
    marks: { run: workerMarksRun(resolve(logs, "resume-attempts.json")) },
    concurrency: 1,
  };
}

function zParsePrs(raw: string): ListedFactoryPr[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("gh pr list did not return an array");
  return parsed.map((item) => ListedFactoryPr.parse(item));
}

/** CLI entry: `npm run ci-repair -- <pr>`, `--branch <name>` or `--all`. */
async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const host = cliHost(root);
  const all = args.includes("--all");
  const branchIndex = args.indexOf("--branch");
  const prArg = args.find((arg) => !arg.startsWith("--"));
  let prNumber: number | undefined;
  if (!all) {
    if (branchIndex !== -1) {
      const branch = args[branchIndex + 1];
      if (branch === undefined) throw new Error("--branch needs a branch name");
      const command = (program: string, params: readonly string[]): string =>
        execFileSync(program, [...params], { cwd: root, encoding: "utf8" }).trim();
      const found = zParsePrs(command("gh", ["pr", "list", "--repo", "rubixhacker/komotion", "--state", "open", "--head", branch, "--json", FACTORY_PR_JSON_FIELDS]));
      prNumber = found[0]?.number;
      if (prNumber === undefined) throw new Error(`no open factory pull request for ${branch}`);
    } else if (prArg !== undefined) {
      prNumber = Number(prArg);
      if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error(`invalid pull request: ${prArg}`);
    } else {
      throw new Error("usage: npm run ci-repair -- <pr> | --branch <name> | --all");
    }
  }
  if (all) {
    const failed = selectFailedFactoryPrs(host.listFactoryPrs());
    if (failed.length === 0) {
      host.log("No open factory pull request needs CI repair.");
      return;
    }
    await runCiRepairEntries(failed, host);
    return;
  }
  if (prNumber !== undefined) await runCiRepair(prNumber, host);
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main();
}
