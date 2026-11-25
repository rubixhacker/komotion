import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  deliveryFailedCount,
  deliveryStallState,
  parseDeliveryWindowMinutes,
  readDeliveryFacts,
} from "./delivery-stall.mjs";
import { FACTORY_PR_JSON_FIELDS, ListedFactoryPr } from "./factory-prs.mjs";
import { REPO } from "./queue.mjs";
import { heldByBranch, readStatus, type FactoryStatus } from "./status.mjs";
import {
  describeFactoryView,
  factoryViewExitCode,
  staleStatusError,
  type ResumableBranch,
} from "./status-view.mjs";

/**
 * Print one wide view of what the factory is doing right now, and fail when it
 * is stuck. Pass phase and in-flight tickets come from the status file, the
 * retained branches from local git plus the resume ledger, and the open
 * delivery pull requests from GitHub. A section that cannot be read is named
 * as unreadable instead of hiding the rest.
 *
 * Exit codes: 0 when a pass is running or finished cleanly, 1 when the pass is
 * stale or failed. A timer or a human can therefore use it as a health probe.
 * The delivery line reports the stall decision the Grafana alert fires on; it
 * is a separate signal from the pass's own health, so it changes no exit code.
 */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/** The heads the factory has already tried to resume, keyed by commit. */
function attemptedHeads(path: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Local ticket branches that still hold work worth resuming. Mirrors the
 * factory's own `retainedHead`: a branch with no commits past origin/main, or
 * whose commits have all landed on main, holds nothing to resume. When the
 * queue was read, only tickets it says are branch-held are listed, so a branch
 * for a closed ticket does not masquerade as resumable.
 */
function collectResumableBranches(
  root: string,
  attempted: ReadonlySet<string>,
  branchHeld: ReadonlySet<number> | null,
): ResumableBranch[] | null {
  try {
    const branches = git(root, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/sandcastle/issue-",
    ])
      .split("\n")
      .filter((line) => line !== "");
    const result: ResumableBranch[] = [];
    for (const branch of branches) {
      const match = /^sandcastle\/issue-(\d+)$/.exec(branch);
      if (match === null) continue;
      const issue = Number(match[1]);
      if (branchHeld !== null && !branchHeld.has(issue)) continue;
      try {
        if (Number(git(root, ["rev-list", "--count", `origin/main..${branch}`])) === 0) continue;
        const cherry = git(root, ["cherry", "origin/main", branch]);
        if (!cherry.split("\n").some((line) => line.startsWith("+"))) continue;
        const head = git(root, ["rev-parse", branch]);
        result.push({
          issue,
          branch,
          head: head.slice(0, 7),
          resumeExhausted: attempted.has(head),
        });
      } catch {
        // A branch that cannot be inspected holds nothing the operator can act on.
      }
    }
    return result.sort((a, b) => a.issue - b.issue);
  } catch (error) {
    console.error(`resumable branches unreadable: ${messageOf(error)}`);
    return null;
  }
}

/** The open pull requests, or null when the listing could not be read. */
function collectPullRequests(root: string): ListedFactoryPr[] | null {
  try {
    return z.array(ListedFactoryPr).parse(
      JSON.parse(
        execFileSync(
          "gh",
          [
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
          ],
          { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        ).trim(),
      ),
    );
  } catch (error) {
    console.error(`pull requests unreadable: ${messageOf(error)}`);
    return null;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Read the same configuration the factory loads, so the status line uses the
// same delivery-stall window as the exporter.
try {
  process.loadEnvFile(resolve(root, ".sandcastle/.env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const maxIdleMinutes = Number(
  process.env.SANDCASTLE_STATUS_MAX_IDLE_MINUTES ?? "90",
);
// A malformed window falls back to the default, the same way the exporter
// does, so `npm run status` and the Grafana alert never disagree on the window.
const deliveryWindowMinutes = parseDeliveryWindowMinutes(
  process.env.SANDCASTLE_DELIVERY_STALL_MINUTES,
);
const now = new Date();
const logsDir = resolve(root, ".sandcastle/logs");
let status: FactoryStatus | null | "unreadable" = null;
try {
  status = readStatus(resolve(logsDir, "status.json"));
} catch (error) {
  status = "unreadable";
  console.error(`pass status unreadable: ${messageOf(error)}`);
}
const branchHeld =
  status === null || status === "unreadable" ? null : new Set(heldByBranch(status));
const resumable = collectResumableBranches(
  root,
  attemptedHeads(resolve(logsDir, "resume-attempts.json")),
  branchHeld,
);
console.log(describeFactoryView({ status, resumable, pullRequests: collectPullRequests(root) }, now));
if (status !== null && status !== "unreadable" && status.error !== null)
  console.error(`Last error: ${status.error}`);

const stall = deliveryStallState(
  now,
  readDeliveryFacts(resolve(logsDir, "delivery-stall.json")).lastDeliveryAt,
  deliveryFailedCount(logsDir),
  deliveryWindowMinutes,
);
if (stall.stalled) {
  const reasons = [
    stall.deliveryFailed ? "a delivery failed and was escalated to a human" : null,
    stall.noNewDelivery
      ? `no new delivery for ${Math.floor((stall.lastDeliveryAgeSeconds ?? 0) / 3600)}h (window ${stall.windowMinutes}m)`
      : null,
  ].filter((reason): reason is string => reason !== null);
  console.error(`delivery stalled: ${reasons.join("; ")}`);
} else {
  const age =
    stall.lastDeliveryAgeSeconds === null
      ? "no delivery yet"
      : `last delivery ${Math.floor(stall.lastDeliveryAgeSeconds / 3600)}h ago`;
  console.log(`delivery ok: ${age}, no failed deliveries`);
}

const stale = staleStatusError(status, now, maxIdleMinutes);
if (stale !== null) console.error(stale);
const exitCode = factoryViewExitCode(status, now, maxIdleMinutes);
if (exitCode !== 0) process.exit(exitCode);
