// Factory pass: plan → implement + review + gate → push + open PR.
//
// One invocation is one pass. The launchd factory lane calls it every 5
// minutes and on GitHub dispatch events; the lock keeps a new pass from
// starting while another is running. The factory never merges to main: each
// ticket lands as a pull request a human reviews, and the pull request's
// `Closes #<n>` closes the issue once the human merges it.
//
// A ticket that keeps failing collects strikes. After SANDCASTLE_TICKET_STRIKES
// strikes the factory hands it to a human (ready-for-interactive-agent)
// instead of retrying forever; putting ready-for-agent back requeues it.
//
// Usage:
//   npx tsx .sandcastle/main.mts          # run one pass
//   npx tsx .sandcastle/main.mts --check  # verify the environment, then exit

import * as sandcastle from "@ai-hero/sandcastle";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { acquireLock } from "./lock.mts";
import { factorySandbox } from "./macos.mts";

const root = resolve(process.cwd());
try {
  process.loadEnvFile(resolve(root, ".sandcastle/.env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config = z
  .object({
    GITHUB_REPO: z.string().default("rubixhacker/komotion"),
    // The label that puts an issue on the factory's queue.
    QUEUE_LABEL: z.string().default("ready-for-agent"),
    // The label the factory adds to an issue while a worker is on it.
    INFLIGHT_LABEL: z.string().default("factory-inflight"),
    // The label the factory adds when it hands a ticket to a human.
    HANDOFF_LABEL: z.string().default("ready-for-interactive-agent"),
    // The agent model.
    SANDCASTLE_MODEL: z.string().default("vllm/Qwen3.8"),
    // The OpenAI-compatible endpoint that serves the model.
    VLLM_BASE_URL: z.url().default("http://192.168.1.3:18982/v1"),
    // The new tickets one pass may start.
    SANDCASTLE_MAX_ISSUES: z.coerce.number().int().min(1).max(10).default(3),
    // How many tickets a pass works on at once.
    SANDCASTLE_PARALLELISM: z.coerce.number().int().min(1).max(4).default(2),
    // A ticket that has not finished by then is stalled, not slow.
    SANDCASTLE_TICKET_BUDGET_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
    // Failed attempts (declines, stalls, failed gates) a ticket gets before
    // the factory hands it to a human instead of trying again.
    SANDCASTLE_TICKET_STRIKES: z.coerce.number().int().min(1).max(10).default(3),
    // The quality gate: the same command the repository's CI runs.
    GATE_COMMAND: z.string().default("./gradlew desktopTest"),
    GATE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  })
  .parse(process.env);

const agentModel = config.SANDCASTLE_MODEL;

/**
 * The env a sandboxed agent run needs to find the model: the vLLM provider
 * config (the sandbox has no host OpenCode config to fall back on) and the
 * endpoint that serves the model.
 */
function agentRunEnv(): Record<string, string> {
  return {
    OPENCODE_CONFIG_CONTENT: readFileSync(resolve(root, ".sandcastle/opencode.json"), "utf8"),
    VLLM_BASE_URL: config.VLLM_BASE_URL,
  };
}

// ---------------------------------------------------------------------------
// GitHub on the host. The sandbox never sees a GitHub credential: seatbelt
// hides the host's gh login, and the factory reads and writes GitHub itself.
// ---------------------------------------------------------------------------

function gh(args: readonly string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function ghJson<T>(args: readonly string[]): T {
  return JSON.parse(gh(args)) as T;
}

function addLabel(issue: number, label: string): void {
  gh(["issue", "edit", String(issue), "--add-label", label, "--repo", config.GITHUB_REPO]);
}

function removeLabel(issue: number, label: string): void {
  gh(["issue", "edit", String(issue), "--remove-label", label, "--repo", config.GITHUB_REPO]);
}

interface QueueIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: { author: string; body: string }[];
}

function fetchQueue(): QueueIssue[] {
  return ghJson<QueueIssue[]>([
    "issue",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--label",
    config.QUEUE_LABEL,
    "--state",
    "open",
    "--json",
    "number,title,body,labels,comments",
    "--jq",
    '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[] | {author: .author.login, body: .body}]}]',
  ]);
}

/**
 * Issues an open factory pull request already owns. The factory does not
 * start a second worker on a ticket whose branch is still under review.
 */
function claimedIssues(): Set<number> {
  const prs = ghJson<{ headRefName: string }[]>([
    "pr",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--state",
    "open",
    "--json",
    "headRefName",
  ]);
  const claimed = new Set<number>();
  for (const pr of prs) {
    const match = /^sandcastle\/issue-(\d+)$/.exec(pr.headRefName);
    if (match) claimed.add(Number(match[1]));
  }
  return claimed;
}

// ---------------------------------------------------------------------------
// Strike ledger: .sandcastle/logs/strikes.json (gitignored)
// ---------------------------------------------------------------------------

interface Strike {
  count: number;
  lastFailure: string;
  at: string;
}

type StrikeLedger = Record<string, Strike>;

function strikesPath(): string {
  return resolve(root, ".sandcastle/logs/strikes.json");
}

function readStrikes(): StrikeLedger {
  try {
    return JSON.parse(readFileSync(strikesPath(), "utf8")) as StrikeLedger;
  } catch {
    return {};
  }
}

function writeStrikes(ledger: StrikeLedger): void {
  mkdirSync(resolve(root, ".sandcastle/logs"), { recursive: true });
  writeFileSync(strikesPath(), JSON.stringify(ledger, null, 2));
}

// ---------------------------------------------------------------------------
// Environment check
// ---------------------------------------------------------------------------

function check(): void {
  const failures: string[] = [];
  try {
    gh(["api", `repos/${config.GITHUB_REPO}`, "--jq", ".full_name"]);
  } catch {
    failures.push(`gh cannot read ${config.GITHUB_REPO}`);
  }
  const model = agentModel.split("/")[1] ?? agentModel;
  try {
    const body = execFileSync("curl", [
      "-fsS",
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
      `${config.VLLM_BASE_URL}/models`,
    ], { encoding: "utf8" });
    if (!body.includes(model))
      failures.push(`vLLM at ${config.VLLM_BASE_URL} does not serve ${model}`);
  } catch {
    failures.push(`vLLM at ${config.VLLM_BASE_URL} is not reachable`);
  }
  try {
    execFileSync("opencode", ["--version"], { encoding: "utf8" });
  } catch {
    failures.push("opencode is not on PATH");
  }
  try {
    execFileSync("java", ["-version"], { encoding: "utf8" });
  } catch {
    failures.push("java is not on PATH");
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`check: ${failure}`);
    process.exit(1);
  }
  console.log("check: environment is ready");
}

if (process.argv.includes("--check")) {
  check();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

const release = acquireLock(root, "factory");
if (release === null) {
  // Another pass is already running. The lane wrapper reads 75 as clean.
  console.log("factory: another pass is running; not starting a new one");
  process.exit(75);
}

interface PlanIssue {
  id: string;
  title: string;
  branch: string;
}

const planSchema = z.object({
  issues: z.array(z.object({ id: z.string(), title: z.string(), branch: z.string() })),
});

interface TicketResult {
  issue: QueueIssue;
  branch: string;
  status: "delivered" | "failed";
  detail: string;
}

async function main(): Promise<void> {
  const queue = fetchQueue();
  const claimed = claimedIssues();
  const eligible = queue.filter((issue) => !claimed.has(issue.number));
  console.log(
    `factory: ${queue.length} queued, ${eligible.length} eligible (the rest are already under review)`,
  );
  if (eligible.length === 0) {
    console.log("factory: nothing to do");
    return;
  }

  // -------------------------------------------------------------------------
  // Plan: pick the issues that can be worked in parallel right now.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    sandbox: factorySandbox(),
    name: "planner",
    maxIterations: 1,
    agent: sandcastle.opencode(agentModel, {
      captureSessions: false,
      env: agentRunEnv(),
    }),
    promptFile: "./.sandcastle/plan-prompt.md",
    promptArgs: {
      ISSUES: JSON.stringify(eligible, null, 2),
    },
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
    cwd: root,
  });

  const planned: PlanIssue[] = plan.output.issues.slice(0, config.SANDCASTLE_MAX_ISSUES);
  console.log(`planner picked ${planned.length} issue(s):`);
  for (const issue of planned)
    console.log(`  #${issue.id}: ${issue.title} → ${issue.branch}`);
  if (planned.length === 0) {
    console.log("factory: everything is blocked; nothing to do");
    return;
  }

  const byNumber = new Map(eligible.map((issue) => [issue.number, issue]));
  const results = await pool(
    planned,
    config.SANDCASTLE_PARALLELISM,
    (plannedIssue) => workTicket(byNumber.get(Number(plannedIssue.id))),
    (plannedIssue) => `#${plannedIssue.id}`,
  );
  for (const result of results) {
    if (result === null) continue;
    console.log(
      `factory: #${result.issue.number} ${result.status} — ${result.detail}`,
    );
  }
}

/**
 * Run `fn` over `items` with at most `limit` workers in flight.
 */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<TicketResult | null>,
  label: (item: T) => string,
): Promise<(TicketResult | null)[]> {
  const settled: (TicketResult | null)[] = items.map(() => null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        settled[i] = await fn(items[i]);
      } catch (error) {
        console.error(`factory: ticket ${label(items[i])} failed: ${String(error)}`);
      }
    }
  });
  await Promise.allSettled(workers);
  return settled;
}

/**
 * One ticket: implement, review, gate, then deliver a pull request or
 * collect a strike.
 */
async function workTicket(
  issue: QueueIssue | undefined,
): Promise<TicketResult | null> {
  if (issue === undefined) return null;
  const branch = `sandcastle/issue-${issue.number}`;
  const contextFile = `issue-context-${issue.number}.json`;
  // The host owns the issue's text: the sandbox has no GitHub credential.
  const contextPath = resolve(root, ".sandcastle/logs", contextFile);
  mkdirSync(resolve(root, ".sandcastle/logs"), { recursive: true });
  writeFileSync(contextPath, JSON.stringify(issue, null, 2));

  addLabel(issue.number, config.INFLIGHT_LABEL);

  let sandbox: sandcastle.Sandbox;
  try {
    sandbox = await sandcastle.createSandbox({
      branch,
      baseBranch: "origin/main",
      sandbox: factorySandbox(),
      cwd: root,
      hooks: {
        host: {
          onWorktreeReady: [
            {
              command: `mkdir -p .sandcastle/agent && cp -R ${shellQuote(
                resolve(root, ".sandcastle/agent"),
              )}/. .sandcastle/agent && cp ${shellQuote(contextPath)} .sandcastle/${contextFile}`,
            },
          ],
        },
      },
    });
  } catch (error) {
    removeLabel(issue.number, config.INFLIGHT_LABEL);
    throw error;
  }

  const agentEnv = {
    OPENCODE_CONFIG_DIR: `${sandbox.worktreePath}/.sandcastle/agent`,
    ...agentRunEnv(),
    OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: String(30 * 60_000),
  };
  const budgetSignal = AbortSignal.timeout(config.SANDCASTLE_TICKET_BUDGET_MINUTES * 60_000);
  let failure: string | null = null;
  let commits: { sha: string }[] = [];

  try {
    const implement = await sandbox.run({
      name: `implementer #${issue.number}`,
      maxIterations: 100,
      agent: sandcastle.opencode(agentModel, { captureSessions: false, env: agentEnv }),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: {
        TASK_ID: String(issue.number),
        ISSUE_TITLE: issue.title,
        BRANCH: branch,
        ISSUE_CONTEXT_FILE: contextFile,
      },
      signal: budgetSignal,
    });
    commits = implement.commits;

    if (commits.length > 0) {
      const review = await sandbox.run({
        name: `reviewer #${issue.number}`,
        maxIterations: 1,
        agent: sandcastle.opencode(agentModel, { captureSessions: false, env: agentEnv }),
        promptFile: "./.sandcastle/review-prompt.md",
        // TARGET_BRANCH is a built-in prompt argument (the host's current
        // branch, which the runtime keeps at origin/main), so it cannot be
        // passed here.
        promptArgs: {
          BRANCH: branch,
        },
        signal: budgetSignal,
      });
      commits = [...commits, ...review.commits];
    }
  } catch (error) {
    failure = `agent run failed: ${String(error)}`;
  }

  // The quality gate is run by the orchestrator, not the agent: an agent
  // never gets to say "tests pass".
  let gateFailed = false;
  if (failure === null && commits.length > 0) {
    try {
      const gate = execFileSync(config.GATE_COMMAND.split(" ")[0], config.GATE_COMMAND.split(" ").slice(1), {
        cwd: sandbox.worktreePath,
        timeout: config.GATE_MINUTES * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      });
      void gate;
    } catch (error) {
      gateFailed = true;
      failure = `gate ${config.GATE_COMMAND} failed: ${tail(String(error), 2000)}`;
    }
  }

  await sandbox.close();

  if (failure === null && commits.length > 0) {
    try {
      deliver(issue, branch);
      clearStrike(issue.number);
      removeLabel(issue.number, config.INFLIGHT_LABEL);
      return { issue, branch, status: "delivered", detail: "pull request opened" };
    } catch (error) {
      failure = `delivery failed: ${String(error)}`;
    }
  }

  // A failed attempt collects a strike; at the limit the ticket is handed to
  // a human instead of retried forever.
  if (failure !== null) {
    const ledger = readStrikes();
    const strike = ledger[String(issue.number)] ?? {
      count: 0,
      lastFailure: "",
      at: new Date().toISOString(),
    };
    strike.count += 1;
    strike.lastFailure = failure;
    strike.at = new Date().toISOString();
    ledger[String(issue.number)] = strike;
    writeStrikes(ledger);
    if (strike.count >= config.SANDCASTLE_TICKET_STRIKES) {
      addLabel(issue.number, config.HANDOFF_LABEL);
      removeLabel(issue.number, config.QUEUE_LABEL);
      gh([
        "issue",
        "comment",
        "--repo",
        config.GITHUB_REPO,
        "--body",
        [
          `The factory handed this ticket to a human after ${strike.count} failed attempts.`,
          "",
          `Last failure: ${strike.lastFailure}`,
          "",
          "Put `ready-for-agent` back to requeue it.",
        ].join("\n"),
        String(issue.number),
      ]);
      clearStrike(issue.number);
    }
    removeLabel(issue.number, config.INFLIGHT_LABEL);
  }
  return { issue, branch, status: "failed", detail: failure ?? "no commits" };
}

/**
 * Push the branch and open the pull request. The branch ref lives in the
 * runtime checkout (worktrees share the main repo's refs), so the push comes
 * from there, after the worktree is gone.
 */
function deliver(issue: QueueIssue, branch: string): void {
  execFileSync("git", ["-C", root, "push", "origin", branch], { encoding: "utf8" });
  const url = gh([
    "pr",
    "create",
    "--repo",
    config.GITHUB_REPO,
    "--head",
    branch,
    "--title",
    `# ${issue.number}: ${issue.title}`,
    "--body",
    [
      `Automated factory pass for issue #${issue.number}.`,
      "",
      `- Branch: \`${branch}\``,
      `- Implementer + reviewer: Sandcastle (\`${agentModel}\`)`,
      `- Gate: \`${config.GATE_COMMAND}\` passed on this branch`,
      "",
      `Closes #${issue.number}`,
    ].join("\n"),
  ]);
  gh([
    "issue",
    "comment",
    "--repo",
    config.GITHUB_REPO,
    "--body",
    `The factory opened a pull request for this issue: ${url.trim()}`,
    String(issue.number),
  ]);
}

function clearStrike(issueNumber: number): void {
  const ledger = readStrikes();
  if (ledger[String(issueNumber)]) {
    delete ledger[String(issueNumber)];
    writeStrikes(ledger);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function tail(value: string, length: number): string {
  return value.length <= length ? value : `…${value.slice(-length)}`;
}

main()
  .then(() => {
    console.log("factory: pass complete");
  })
  .catch((error) => {
    console.error(`factory: pass failed: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    release();
  });
