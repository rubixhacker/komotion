import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  cancelledChecks,
  failingChecks,
  ownsFactoryPr,
  passedChecks,
  skippedChecks,
  type FactoryPr,
} from "./factory-ci.mjs";
import { green as requiredChecksGreen } from "./dependabot-policy.mjs";
import {
  describeStreak,
  retryAfter,
  Streaks,
  type Streaks as StreaksMap,
} from "./failure-streak.mjs";
import { REPO } from "./queue.mjs";
import { describeStatus, readStatus, statusIsStale, type FactoryStatus } from "./status.mjs";
import { FACTORY_PR_JSON_FIELDS, ListedFactoryPr } from "./factory-prs.mjs";
import { TicketLedger, type Strike } from "./ticket-ledger.mjs";

/**
 * One invocation reports the whole Sandcastle fleet: every unit's state, the
 * factory pass with its queue and in-flight tickets, the open pull requests
 * with a one-line check summary, and the recent failures. Triage reads this
 * instead of a dozen individual CLI calls.
 *
 * A section that cannot be read is reported as such rather than failing the
 * report: the fleet is read-only, and one unreadable section must not hide
 * the rest. A section whose file is absent is not unreadable — it reads as
 * "none", because nothing was there to read.
 */

/** The state of one installed Sandcastle unit, as its launchd agent reports it. */
export interface UnitState {
  /** The launchd label of the lane. */
  readonly unit: string;
  /** Whether the agent is running, or a reason it could not be read. */
  readonly active: string;
  /** Whether the agent is loaded, or a reason it could not be read. */
  readonly enabled: string;
}

/**
 * Filter a list of unit files down to the real units, excluding templates —
 * a template is only instantiated when a unit fails, and its own state says
 * nothing about the fleet.
 */
export function fleetUnits(files: readonly string[]): string[] {
  return files
    .filter((file) => /\.(service|container|timer|path)$/.test(file) && !file.includes("@"))
    .sort();
}

export function describeUnits(states: readonly UnitState[]): string {
  return states
    .map((state) => `    ${state.unit}: ${state.active} (${state.enabled})`)
    .join("\n");
}

function checkName(check: NonNullable<FactoryPr["statusCheckRollup"]>[number]): string {
  return check.name ?? check.context ?? "unnamed check";
}

/**
 * One line of what a pull request's checks say: what is failing, what was
 * stopped before a verdict, what completed without a pass or a fail, what
 * passed, whether the base conflicts, what is still running, and whether the
 * checks are green.
 *
 * "Green" is the factory's own merge-green definition, so a classifier-backed
 * iOS skip counts as passing the way the merge gate does. A completed check
 * that is neither a pass nor a fail is summarized as skipped, not left out:
 * only a rollup with no checks at all says "no checks yet".
 */
export function summarizeChecks(pr: FactoryPr): string {
  const parts: string[] = [];
  if (pr.mergeable === "CONFLICTING") parts.push("conflict");
  const failed = failingChecks(pr);
  if (failed.length > 0) parts.push(`${failed.length} failed (${failed.map(checkName).join(", ")})`);
  const cancelled = cancelledChecks(pr);
  if (cancelled.length > 0) parts.push(`${cancelled.length} cancelled`);
  const skipped = skippedChecks(pr);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  const passed = passedChecks(pr);
  const green = requiredChecksGreen(pr);
  if (passed.length > 0 && !green) parts.push(`${passed.length} passed`);
  if (green) parts.push("green");
  const running = (pr.statusCheckRollup ?? []).filter((check) =>
    check.__typename === "StatusContext"
      ? !["SUCCESS", "FAILURE", "ERROR", "NEUTRAL"].includes(check.state ?? "")
      : check.status !== "COMPLETED",
  );
  if (running.length > 0) parts.push(`${running.length} running`);
  return parts.length === 0 ? "no checks yet" : parts.join(", ");
}

/** A recent strike on a ticket, with the ticket it was recorded on. */
export interface TicketStrike {
  readonly issue: number;
  readonly strike: Strike;
}

/**
 * The whole fleet, ready to be described. Each section is its data, `null`
 * when the section could not be read, or — for the factory pass — the string
 * `"unreadable"` when the status file was present but unreadable. An absent
 * file is not unreadable: the status reads as "no pass", the streaks, alerts
 * and strikes read as none.
 */
export interface FleetReport {
  readonly units: readonly UnitState[] | null;
  readonly status: FactoryStatus | null | "unreadable";
  readonly pullRequests: readonly ListedFactoryPr[] | null;
  /** Failure streaks the lanes recorded, keyed by the lane's scope. */
  readonly streaks: StreaksMap | null;
  /** The recent alert log entries. */
  readonly alerts: readonly string[] | null;
  readonly strikes: readonly TicketStrike[] | null;
}

const MAX_PR_LINES = 10;
const MAX_ALERT_LINES = 5;
const MAX_STRIKE_LINES = 5;
const MAX_STREAK_LINES = 5;

export function describeFleet(report: FleetReport, now: Date): string {
  const lines: string[] = ["sandcastle fleet:"];
  lines.push("  units:");
  if (report.units === null) lines.push("    (unreadable)");
  else if (report.units.length === 0) lines.push("    (no units installed)");
  else lines.push(describeUnits(report.units));
  lines.push("  factory pass:");
  if (report.status === null) lines.push("    (no pass has recorded a status)");
  else if (report.status === "unreadable") lines.push("    (unreadable)");
  else
    lines.push(
      describeStatus(report.status, now)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
  lines.push("  pull requests:");
  if (report.pullRequests === null) lines.push("    (unreadable)");
  else lines.push(...describePullRequests(report.pullRequests));
  lines.push("  recent failures:");
  const unreadable: string[] = [];
  const failures: string[] = [];
  if (report.streaks === null) unreadable.push("failure-streaks.json");
  else
    for (const [name, streak] of Object.entries(report.streaks))
      failures.push(`    ${describeStreak(name, streak, retryAfter(streak, now))}`);
  if (report.alerts === null) unreadable.push("factory-alerts.log");
  else failures.push(...report.alerts.map((line) => `    ${line}`));
  if (report.strikes === null) unreadable.push("ticket-ledger.json");
  else
    failures.push(
      ...report.strikes.map(({ issue, strike }) => {
        const detail =
          strike.detail === "" ? "" : ` — ${strike.detail.split("\n")[0]?.slice(0, 200)}`;
        return `    #${issue}: ${strike.at} ${strike.kind}${detail}`;
      }),
    );
  if (failures.length === 0 && unreadable.length === 0) lines.push("    (none recorded)");
  else {
    if (unreadable.length > 0) lines.push(`    (${unreadable.join(", ")} unreadable)`);
    lines.push(...failures);
  }
  return lines.join("\n");
}

function describePullRequests(pullRequests: readonly ListedFactoryPr[]): string[] {
  const factory = pullRequests.filter(ownsFactoryPr);
  const shown = factory.slice(0, MAX_PR_LINES);
  const lines = shown.map((pr) => `    #${pr.number} ${pr.title}: ${summarizeChecks(pr)}`);
  if (factory.length > shown.length)
    lines.push(`    ${factory.length - shown.length} more open factory PRs`);
  const others = pullRequests.length - factory.length;
  if (others > 0) lines.push(`    ${others} open non-factory PRs`);
  if (lines.length === 0) lines.push("    (no open pull requests)");
  return lines;
}

/** The host the fleet reads from: the checkout root and its commands. */
export interface FleetHost {
  readonly root: string;
  /** Run one host command and return its output. */
  readonly command: (program: string, args: readonly string[]) => string;
  /** Query one installed unit's state, as launchctl reports it. */
  readonly unitQuery: (unit: string, query: string) => string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An alert log entry starts with its timestamp; the status lines after it do not. */
const ALERT_ENTRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** The recent alert entries, or null when the log is present but unreadable. */
export function recentAlerts(path: string, limit: number): string[] | null {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => ALERT_ENTRY.test(line))
      .slice(-limit);
  } catch (error) {
    console.error(`alerts unreadable: ${messageOf(error)}`);
    return null;
  }
}

/** The recent failure streaks, or null when the file is present but unreadable. */
export function recentStreaks(path: string, limit: number): StreaksMap | null {
  if (!existsSync(path)) return {};
  try {
    const entries = Object.entries(Streaks.parse(JSON.parse(readFileSync(path, "utf8"))));
    return Object.fromEntries(entries.slice(0, limit));
  } catch (error) {
    console.error(`failure streaks unreadable: ${messageOf(error)}`);
    return null;
  }
}

/** The recent ticket strikes, or null when the ledger is present but unreadable. */
export function recentStrikes(path: string, limit: number): TicketStrike[] | null {
  if (!existsSync(path)) return [];
  try {
    const ledger = TicketLedger.parse(JSON.parse(readFileSync(path, "utf8")));
    return Object.entries(ledger)
      .flatMap(([issue, entry]) => entry.strikes.map((strike) => ({ issue: Number(issue), strike })))
      .sort((a, b) => b.strike.at.localeCompare(a.strike.at))
      .slice(0, limit);
  } catch (error) {
    console.error(`ticket strikes unreadable: ${messageOf(error)}`);
    return null;
  }
}

/**
 * Read the whole fleet: every unit's state, the factory pass, the open pull
 * requests, and the recent failures. Each section that cannot be read is
 * reported as such, with the reason on stderr; a section whose file is absent
 * reads as none.
 */
export function collectFleet(host: FleetHost): FleetReport {
  let units: readonly UnitState[] | null = null;
  try {
    // The repository carries templates; the installed agents are what run.
    const agents = resolve(homedir(), "Library/LaunchAgents");
    units = readdirSync(agents)
      .filter((file) => file.startsWith("com.rubixhacker.sandcastle.") && file.endsWith(".plist"))
      .map((file) => {
        const unit = file.slice(0, -".plist".length);
        return {
          unit,
          active: host.unitQuery(unit, "state"),
          enabled: host.unitQuery(unit, "loaded"),
        };
      })
      .sort((a, b) => a.unit.localeCompare(b.unit));
  } catch (error) {
    units = null;
    console.error(`units unreadable: ${messageOf(error)}`);
  }

  let status: FactoryStatus | null | "unreadable" = null;
  const statusPath = resolve(host.root, ".sandcastle/logs/status.json");
  if (existsSync(statusPath)) {
    try {
      status = readStatus(statusPath);
    } catch (error) {
      status = "unreadable";
      console.error(`pass status unreadable: ${messageOf(error)}`);
    }
  }

  let pullRequests: readonly ListedFactoryPr[] | null = null;
  try {
    pullRequests = z.array(ListedFactoryPr).parse(
      JSON.parse(
        host.command("gh", [
          "pr",
          "list",
          "--repo",
          REPO,
          "--state",
          "open",
          "--limit",
          "200",
          "--json",
          FACTORY_PR_JSON_FIELDS,
        ]),
      ),
    );
  } catch (error) {
    console.error(`pull requests unreadable: ${messageOf(error)}`);
  }

  return {
    units,
    status,
    pullRequests,
    streaks: recentStreaks(resolve(host.root, ".sandcastle/logs/failure-streaks.json"), MAX_STREAK_LINES),
    alerts: recentAlerts(resolve(host.root, ".sandcastle/logs/factory-alerts.log"), MAX_ALERT_LINES),
    strikes: recentStrikes(resolve(host.root, ".sandcastle/logs/ticket-ledger.json"), MAX_STRIKE_LINES),
  };
}

/** One launchd query: whether the agent is loaded, and whether it is running. */
function launchdQuery(label: string, query: string): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const printed = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], { encoding: "utf8" });
  if (printed.error !== undefined || printed.status !== 0) return "not loaded";
  if (query === "loaded") return "loaded";
  const state = /state = ([^\n]+)/.exec(printed.stdout ?? "")?.[1]?.trim();
  return state ?? "unknown";
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const host: FleetHost = {
    root,
    command: (program, args) =>
      execFileSync(program, [...args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }).trim(),
    unitQuery: (unit, query) => launchdQuery(unit, query),
  };
  const now = new Date();
  const report = collectFleet(host);
  console.log(describeFleet(report, now));
  const status = report.status;
  if (status !== null && status !== "unreadable") {
    if (status.error !== null) console.error(`Last error: ${status.error}`);
    const maxIdleMinutes = Number(process.env.SANDCASTLE_STATUS_MAX_IDLE_MINUTES ?? "90");
    if (statusIsStale(status, now, maxIdleMinutes * 60_000)) {
      console.error(
        `The pass has not updated for over ${maxIdleMinutes} minutes; check launchctl print gui/$(id -u)/com.rubixhacker.sandcastle.factory`,
      );
      process.exit(1);
    }
    if (status.finishedAt !== null && status.error !== null) process.exit(1);
  }
}

// The report and its readers are pure and importable; the side-effecting entry
// runs only when this file is the command, never when a test imports it.
const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
