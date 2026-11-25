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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enterFactoryLock, factoryLockPath } from "./lock.mjs";
import { ghCommandFailures, GH_MAX_TAIL_BYTES, promptArgFailures } from "./check.mts";
import { runHeavyWork } from "./heavy-work.mts";
import { factorySandbox } from "./macos.mts";
import {
  command,
  commandJson,
  nonInteractiveGitEnv,
  type CommandOptions,
  type CommandResult,
} from "./process.mts";
import {
  createPiAgentDir,
  factoryAgent,
  type FactoryAgent,
  FACTORY_AGENTS,
  DEFAULT_FACTORY_AGENT,
} from "./agent-provider.mjs";
import { acknowledgeEvents, pendingEvents } from "./events.mjs";
import { armFactoryPr, autoMergePolicyFromEnv } from "./arm-merge.mjs";
import { noRebaseCommitEscalation } from "./ci-sweep.mjs";
import { alertOperator } from "./operator-alert.mjs";
import {
  conflictRepairContext,
  rebaseFault,
  reconcileToPrHead,
  startConflictRebase,
} from "./conflict-repair.mjs";

// The entry point may be started from the repo root (launchd) or from
// .sandcastle (npm scripts): always resolve the repository from this file.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
    // The CLI that authors tickets and repairs branches. Host review stays
    // separate; pi is the default and OpenCode is the control route.
    SANDCASTLE_AGENT: z.enum(FACTORY_AGENTS).default(DEFAULT_FACTORY_AGENT),
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
    // The quality gate: the same command the repository's CI runs. Besides
    // the desktop tests, compileAllTargets compiles the main sources of every
    // target in every module, so a change that breaks a non-desktop target
    // (iOS, Android, wasmJs) fails the gate and is not delivered.
    GATE_COMMAND: z.string().default("./gradlew desktopTest compileAllTargets"),
    GATE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    // Exit 75 from the heavy-work gate is a deferral: the ticket survives
    // for the next pass and never collects a strike.
    SANDCASTLE_HEAVY_WORK_WAIT_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
    SANDCASTLE_GIT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  })
  .parse(process.env);

const agentModel = config.SANDCASTLE_MODEL;
const agentKind: FactoryAgent = config.SANDCASTLE_AGENT;

/**
 * Pi reads its provider catalog, skills, sessions and shell policy from one
 * directory. It is built once per process and mounted writable into each
 * sandbox; the OpenCode control route uses the in-tree agent directory instead.
 */
const piAgentDir =
  agentKind === "pi"
    ? createPiAgentDir({
        root,
        models: [agentModel],
        vllmBaseUrl: config.VLLM_BASE_URL,
        keyPath: resolve(process.env.HOME ?? "", ".config/sandcastle/opencode-go.key"),
      })
    : null;

async function passSandbox() {
  return factorySandbox(
    piAgentDir === null
      ? []
      : [{ hostPath: piAgentDir, sandboxPath: piAgentDir, readonly: false }],
  );
}

/**
 * The env a sandboxed agent run needs to find the model: the vLLM provider
 * config (the sandbox has no host OpenCode config to fall back on) and the
 * endpoint that serves the model.
 */
function agentRunEnv(): Record<string, string> {
  return {
    OPENCODE_CONFIG_CONTENT: readFileSync(resolve(root, ".sandcastle/opencode.json"), "utf8"),
    VLLM_BASE_URL: config.VLLM_BASE_URL,
    ...(piAgentDir === null ? {} : { PI_CODING_AGENT_DIR: piAgentDir }),
  };
}

// ---------------------------------------------------------------------------
// GitHub on the host. The sandbox never sees a GitHub credential: seatbelt
// hides the host's gh login, and the factory reads and writes GitHub itself.
// ---------------------------------------------------------------------------

async function gh(args: readonly string[]): Promise<string> {
  return command("gh", [...args], { maxTailBytes: GH_MAX_TAIL_BYTES, timeoutMs: 120_000 });
}

async function ghJson<T>(args: readonly string[]): Promise<T> {
  return commandJson<T>("gh", [...args], { maxTailBytes: GH_MAX_TAIL_BYTES, timeoutMs: 120_000 });
}

async function git(args: readonly string[], options: CommandOptions = {}): Promise<string> {
  return command("git", [...args], {
    env: nonInteractiveGitEnv(),
    maxTailBytes: GH_MAX_TAIL_BYTES,
    timeoutMs: 120_000,
    ...options,
  });
}

async function addLabel(issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--add-label", label, "--repo", config.GITHUB_REPO]);
}

async function removeLabel(issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--remove-label", label, "--repo", config.GITHUB_REPO]);
}

interface QueueIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: { author: string; body: string }[];
}

async function fetchQueue(): Promise<QueueIssue[]> {
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
async function claimedIssues(): Promise<Set<number>> {
  const prs = await ghJson<{ headRefName: string }[]>([
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

/**
 * The branch carries work that has never been delivered: commits ahead of
 * origin/main, and no merged pull request for the branch. The merged-PR
 * check is what makes this safe after a squash merge, which leaves the
 * branch's commits ahead of main even after delivery.
 */
async function branchHasUndeliveredWork(branch: string): Promise<boolean> {
  const merged = await ghJson<{ headRefName: string }[]>([
    "pr",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--state",
    "merged",
    "--json",
    "headRefName",
  ]);
  if (merged.some((pr) => pr.headRefName === branch)) return false;
  let count: string;
  try {
    count = (await git(["-C", root, "rev-list", "--count", `origin/main..${branch}`])).trim();
  } catch {
    return false;
  }
  return Number(count) > 0;
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

// The gh subcommands the host issues. The check validates each one exists
// in the installed gh, so an invalid subcommand is caught before a pass
// spends agent time on it.
const GH_COMMANDS: readonly (readonly string[])[] = [
  ["api"],
  ["issue", "list"],
  ["issue", "edit"],
  ["issue", "comment"],
  ["pr", "list"],
  ["pr", "create"],
  ["pr", "merge"],
  ["pr", "checks"],
];

// The prompt arguments each agent run passes. The check validates the keys
// against the built-in prompt arguments the runtime injects itself, so a
// run cannot collide with one before it starts.
function plannerPromptArgs(issues: QueueIssue[]): Record<string, string> {
  return { ISSUES: JSON.stringify(issues, null, 2) };
}

function implementerPromptArgs(
  issue: QueueIssue,
  branch: string,
  contextFile: string,
): Record<string, string> {
  return {
    TASK_ID: String(issue.number),
    ISSUE_TITLE: issue.title,
    BRANCH: branch,
    ISSUE_CONTEXT_FILE: contextFile,
  };
}

function reviewerPromptArgs(branch: string): Record<string, string> {
  return { BRANCH: branch };
}

async function check(): Promise<void> {
  const failures: string[] = [];
  try {
    await gh(["api", `repos/${config.GITHUB_REPO}`, "--jq", ".full_name"]);
  } catch {
    failures.push(`gh cannot read ${config.GITHUB_REPO}`);
  }
  failures.push(...(await ghCommandFailures(GH_COMMANDS)));
  const dummyIssue: QueueIssue = {
    number: 0,
    title: "",
    body: "",
    labels: [],
    comments: [],
  };
  failures.push(
    ...promptArgFailures([
      ["planner", plannerPromptArgs([])],
      ["implementer", implementerPromptArgs(dummyIssue, "", "")],
      ["reviewer", reviewerPromptArgs("")],
    ]),
  );
  const model = agentModel.split("/")[1] ?? agentModel;
  try {
    const body = await command("curl", [
      "-fsS",
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
      `${config.VLLM_BASE_URL}/models`,
    ], { timeoutMs: 45_000, maxTailBytes: GH_MAX_TAIL_BYTES });
    if (!body.includes(model))
      failures.push(`vLLM at ${config.VLLM_BASE_URL} does not serve ${model}`);
  } catch {
    failures.push(`vLLM at ${config.VLLM_BASE_URL} is not reachable`);
  }
  if (config.SANDCASTLE_AGENT === "pi") {
    try {
      await command("pi", ["--version"], { timeoutMs: 30_000 });
    } catch {
      failures.push("pi is not on PATH");
    }
  } else {
    try {
      await command("opencode", ["--version"], { timeoutMs: 30_000 });
    } catch {
      failures.push("opencode is not on PATH");
    }
  }
  try {
    await command("java", ["-version"], { timeoutMs: 30_000 });
  } catch {
    failures.push("java is not on PATH");
  }
  if (piAgentDir !== null) rmSync(piAgentDir, { recursive: true, force: true });
  if (failures.length > 0) {
    for (const failure of failures) console.error(`check: ${failure}`);
    process.exit(1);
  }
  console.log("check: environment is ready");
}

if (process.argv.includes("--check")) {
  await check();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

// A machine-wide lease, held by a child process for this pass's lifetime,
// prevents a second checkout from running a second factory at the same time.
enterFactoryLock(factoryLockPath("factory.lock"), fileURLToPath(import.meta.url));

// Markers that arrived before this pass started describe state this pass reads
// directly from GitHub. Acknowledge them once; an event that arrives while the
// pass is running survives in the directory and wakes the drain's next pass.
const factoryEvents = resolve(root, ".sandcastle/logs/factory-events");
acknowledgeEvents(factoryEvents, pendingEvents(factoryEvents));

// ---------------------------------------------------------------------------
// Event-driven CI repair worker. The standalone `ci-repair.mts` CLI decides
// which pull request needs work and spawns this process with the exact head it
// decided on. Re-reading the PR here, and refusing a head that moved, keeps a
// stale event from overwriting work delivered after it was queued.
// ---------------------------------------------------------------------------

interface CiRepairArgs {
  pr: number;
  head: string;
  conflict: boolean;
  contextFile: string | null;
  startedFile: string | null;
}

function ciRepairArgs(): CiRepairArgs | null {
  const index = process.argv.indexOf("--ci-repair-perform");
  if (index === -1) return null;
  const value = (flag: string): string | null => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? null : (process.argv[at + 1] ?? null);
  };
  const pr = Number(process.argv[index + 1]);
  const head = value("--ci-repair-head");
  if (!Number.isInteger(pr) || pr <= 0 || head === null)
    throw new Error("usage: --ci-repair-perform <pr> --ci-repair-head <sha>");
  return {
    pr,
    head,
    conflict: process.argv.includes("--conflict"),
    contextFile: value("--ci-repair-context"),
    startedFile: value("--ci-repair-started"),
  };
}

async function performCiRepair(args: CiRepairArgs): Promise<void> {
  const pr = await ghJson<{ headRefName: string; headRefOid: string; title: string }>([
    "pr", "view", String(args.pr), "--repo", config.GITHUB_REPO,
    "--json", "headRefName,headRefOid,title",
  ]);
  if (pr.headRefOid !== args.head) {
    console.log(`#${args.pr}: head moved to ${pr.headRefOid.slice(0, 7)}; leaving it alone`);
    return;
  }
  const branch = pr.headRefName;
  if (!branch.startsWith("sandcastle/issue-"))
    throw new Error(`#${args.pr}: not a factory branch: ${branch}`);
  const issue = Number(/^sandcastle\/issue-(\d+)$/.exec(branch)?.[1] ?? 0);

  await removeWorktreeHolding(branch);
  const sandbox = await sandcastle.createSandbox({
    branch,
    baseBranch: "origin/main",
    sandbox: await passSandbox(),
    cwd: root,
    hooks: {
      host: {
        onWorktreeReady: [
          {
            command: `mkdir -p .sandcastle/agent && cp -R ${shellQuote(
              resolve(root, ".sandcastle/agent"),
            )}/. .sandcastle/agent`,
          },
        ],
      },
    },
  });
  try {
    const tree = sandbox.worktreePath;
    const mainHead = (await git(["-C", root, "rev-parse", "origin/main"])).trim();
    const discarded = reconcileToPrHead(tree, branch, args.head);
    if (discarded !== null)
      console.log(`#${args.pr}: discarded local head ${discarded.slice(0, 7)} in favour of the PR head`);

    const failureFile = `repair-failure-${issue}.txt`;
    if (args.conflict) {
      const messageFile = `.sandcastle/repair-message-${issue}.txt`;
      const start = startConflictRebase(tree, branch, args.head, mainHead, messageFile);
      if (start.state === "refused")
        throw new Error(`#${args.pr}: conflict rebase refused: ${start.reason}`);
      if (start.state === "conflicted") {
        writeFileSync(
          resolve(tree, ".sandcastle", failureFile),
          conflictRepairContext({
            prNumber: args.pr,
            oldHead: args.head,
            main: mainHead,
            conflicted: start.conflicted,
            messageFile,
          }),
        );
      }
    } else if (args.contextFile !== null) {
      writeFileSync(
        resolve(tree, ".sandcastle", failureFile),
        readFileSync(args.contextFile, "utf8"),
      );
    }

    // The CLI uses this marker to tell a worker that never started from one
    // that started and failed. Write it only after the head guard passed.
    if (args.startedFile !== null) {
      mkdirSync(resolve(args.startedFile, ".."), { recursive: true });
      writeFileSync(args.startedFile, "started\n");
    }

    const agentEnv = {
      ...agentRunEnv(),
      OPENCODE_CONFIG_DIR: `${tree}/.sandcastle/agent`,
      OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: String(30 * 60_000),
    };
    const repaired = await sandbox.run({
      name: `ci-repair #${args.pr}`,
      maxIterations: 30,
      agent: factoryAgent(agentModel, agentKind, agentEnv),
      promptFile: "./.sandcastle/factory-repair-prompt.md",
      promptArgs: {
        ISSUE_NUMBER: String(issue),
        TICKET_BRANCH: branch,
        BASE_SHA: mainHead,
        FAILURE_CONTEXT_FILE: failureFile,
      },
      signal: AbortSignal.timeout(config.SANDCASTLE_TICKET_BUDGET_MINUTES * 60_000),
    });
    if (repaired.commits.length === 0)
      throw new Error(`#${args.pr}: repair agent made no commit`);
    const fault = args.conflict
      ? rebaseFault(tree, branch, mainHead, [])
      : null;
    if (fault !== null) throw new Error(`#${args.pr}: ${fault}`);
    const [command, ...gateArgs] = config.GATE_COMMAND.split(" ");
    if (command === undefined) throw new Error("GATE_COMMAND is empty");
    const gate = await runHeavyWork({
      label: `ci-repair-${issue}`,
      program: command,
      args: gateArgs,
      cwd: tree,
      waitSeconds: config.SANDCASTLE_HEAVY_WORK_WAIT_SECONDS,
      timeoutSeconds: config.GATE_MINUTES * 60,
      maxTailBytes: GH_MAX_TAIL_BYTES,
    });
    // A busy gate defers this repair; it is not a failed repair attempt.
    if (gate.code === 75) return;
    if (gate.code !== 0) throw new Error(`#${args.pr}: repair gate exited ${gate.code}`);
    await git(["-C", tree, "push", "--force-with-lease", "origin", branch]);
    console.log(`#${args.pr}: repaired head pushed for re-review`);
  } finally {
    const closed = await sandbox.close();
    if (closed.preservedWorktreePath)
      await git(["-C", root, "worktree", "remove", "--force", closed.preservedWorktreePath]);
  }
}

const repairArgs = ciRepairArgs();
if (repairArgs !== null) {
  try {
    await performCiRepair(repairArgs);
  } finally {
    if (piAgentDir !== null) rmSync(piAgentDir, { recursive: true, force: true });
  }
  process.exit(0);
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
  status: "delivered" | "failed" | "deferred";
  detail: string;
}

async function main(): Promise<void> {
  // Keep open factory pull request branches up to date with main (so they
  // stay mergeable as main moves), and merge the ones whose CI is green.
  // These run on every pass, even when there is no new work.
  await rebaseOpenPrs();

  const queue = await fetchQueue();
  const claimed = await claimedIssues();
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
    sandbox: await passSandbox(),
    name: "planner",
    maxIterations: 1,
    agent: factoryAgent(agentModel, agentKind, agentRunEnv()),
    promptFile: "./.sandcastle/plan-prompt.md",
    promptArgs: plannerPromptArgs(eligible),
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
      const item = items[i];
      if (item === undefined) break;
      try {
        settled[i] = await fn(item);
      } catch (error) {
        console.error(`factory: ticket ${label(item)} failed: ${String(error)}`);
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

  await addLabel(issue.number, config.INFLIGHT_LABEL);

  let sandbox: sandcastle.Sandbox;
  try {
    sandbox = await sandcastle.createSandbox({
      branch,
      baseBranch: "origin/main",
      sandbox: await passSandbox(),
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
    await removeLabel(issue.number, config.INFLIGHT_LABEL);
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
      agent: factoryAgent(agentModel, agentKind, agentEnv),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: implementerPromptArgs(issue, branch, contextFile),
      signal: budgetSignal,
    });
    commits = implement.commits;

    if (commits.length > 0) {
      const review = await sandbox.run({
        name: `reviewer #${issue.number}`,
        maxIterations: 1,
        agent: factoryAgent(agentModel, agentKind, agentEnv),
        promptFile: "./.sandcastle/review-prompt.md",
        // TARGET_BRANCH is a built-in prompt argument (the host's current
        // branch, which the runtime keeps at origin/main), so it cannot be
        // passed here.
        promptArgs: reviewerPromptArgs(branch),
        signal: budgetSignal,
      });
      commits = [...commits, ...review.commits];
    }
  } catch (error) {
    failure = `agent run failed: ${String(error)}`;
  }

  // A previous attempt may have committed work to the branch already
  // (an earlier pass that failed at the gate or delivery). If the
  // implementer made no new commits but the branch carries work that has
  // never been delivered, that work is still deliverable: gate it and
  // push it.
  const hasWork = failure === null && (commits.length > 0 || (await branchHasUndeliveredWork(branch)));

  // The quality gate is run by the orchestrator, not the agent: an agent
  // never gets to say "tests pass". Exit 75 from the heavy-work gate is a
  // deferral, not a failed attempt and not a strike.
  let deferred = false;
  if (hasWork) {
    const [command, ...args] = config.GATE_COMMAND.split(" ");
    if (command === undefined) throw new Error("GATE_COMMAND is empty");
    const gate = await runHeavyWork({
      label: `delivery-gate-issue-${issue.number}`,
      program: command,
      args,
      cwd: sandbox.worktreePath,
      waitSeconds: config.SANDCASTLE_HEAVY_WORK_WAIT_SECONDS,
      timeoutSeconds: config.GATE_MINUTES * 60,
      maxTailBytes: GH_MAX_TAIL_BYTES,
    });
    if (gate.code === 75) {
      deferred = true;
    } else if (gate.code !== 0) {
      failure = `gate ${config.GATE_COMMAND} failed: ${tail(resultOutput(gate), 2000)}`;
    }
  }

  const closed = await sandbox.close();
  // close() preserves the worktree when it is dirty, and the onWorktreeReady
  // hook always dirties it (it copies .sandcastle/agent and the issue context
  // into it). A preserved worktree is never worth keeping: the commits live
  // on the shared branch ref, and the worktree keeps the branch checked out,
  // which blocks any later worktree for the same branch.
  if (closed.preservedWorktreePath) {
    await git(["-C", root, "worktree", "remove", "--force", closed.preservedWorktreePath]);
  }

  if (deferred) {
    await removeLabel(issue.number, config.INFLIGHT_LABEL);
    return { issue, branch, status: "deferred", detail: "heavy-work gate was busy; retrying next pass" };
  }

  if (failure === null && hasWork) {
    try {
      await deliver(issue, branch);
      clearStrike(issue.number);
      await removeLabel(issue.number, config.INFLIGHT_LABEL);
      return { issue, branch, status: "delivered", detail: "pull request opened" };
    } catch (error) {
      failure = `delivery failed: ${String(error)}`;
    }
  }

  // The implementer produced nothing and the branch carries no undelivered
  // work: a failed attempt, not a silent no-op.
  if (failure === null) {
    failure = "no commits";
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
      await addLabel(issue.number, config.HANDOFF_LABEL);
      await removeLabel(issue.number, config.QUEUE_LABEL);
      await gh([
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
    await removeLabel(issue.number, config.INFLIGHT_LABEL);
  }
  return { issue, branch, status: "failed", detail: failure ?? "no commits" };
}

/**
 * Push the branch and open the pull request. The branch ref lives in the
 * runtime checkout (worktrees share the main repo's refs), so the push comes
 * from there, after the worktree is gone.
 */
async function deliver(issue: QueueIssue, branch: string): Promise<void> {
  await git(["-C", root, "push", "origin", branch]);
  const url = await gh([
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
  // GitHub's native auto-merge closes the pull request as soon as CI is
  // green and there is no conflict, so no pass needs to merge it.
  const prNumber = url.trim().split("/").pop() ?? "";
  try {
    await gh(["pr", "merge", prNumber, "--auto", "--squash", "--repo", config.GITHUB_REPO]);
  } catch (error) {
    console.error(`factory: #${issue.number} auto-merge failed: ${String(error)}`);
  }
  await gh([
    "issue",
    "comment",
    "--repo",
    config.GITHUB_REPO,
    "--body",
    `The factory opened a pull request for this issue: ${url.trim()}`,
    String(issue.number),
  ]);
}

// ---------------------------------------------------------------------------
// Keeping open factory pull requests mergeable.
//
// The factory opens a pull request per ticket from a worktree based on
// origin/main at the moment of the pass. As main moves (earlier pull
// requests merge), later branches fall behind and can conflict. Each pass
// rebases every open factory branch onto the latest main, resolving a
// conflict when the changes are compatible. Merging is GitHub's native
// auto-merge, armed at delivery: the pull request closes as soon as CI is
// green and there is no conflict.
// ---------------------------------------------------------------------------

/** Open factory pull requests (the sandcastle/issue-* branches). */
async function openFactoryPrs(): Promise<{
  number: number;
  headRefName: string;
  isDraft: boolean;
  mergeable: string;
}[]> {
  const prs = await ghJson<{ number: number; headRefName: string; isDraft: boolean; mergeable: string }[]>([
    "pr",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--state",
    "open",
    "--json",
    "number,headRefName,isDraft,mergeable",
  ]);
  return prs.filter((pr) => pr.headRefName.startsWith("sandcastle/issue-"));
}

/**
 * Remove a worktree that has `branch` checked out (a preserved ticket
 * worktree), so the branch can be checked out again.
 */
async function removeWorktreeHolding(branch: string): Promise<void> {
  const lines = (await git(["-C", root, "worktree", "list", "--porcelain"])).split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const previous = lines[i - 1];
    if (line === undefined || previous === undefined) continue;
    if (line.trim() === `branch ${branch}`) {
      await git(["-C", root, "worktree", "remove", "--force", previous.slice("worktree ".length)]);
      break;
    }
  }
}

/**
 * Rebase an open factory branch onto the latest main in a throwaway
 * worktree, and force-push the result. Returns false (and leaves the branch
 * as-is) when the rebase conflicts, so a human can resolve it.
 */
async function rebaseBranch(branch: string): Promise<boolean> {
  // The branch name contains a slash (sandcastle/issue-N); the worktree
  // path must stay one directory level deep.
  const worktree = `${root}/.sandcastle/worktrees/rebase-${branch.replace("/", "-")}`;
  // The runtime checkout has no git identity; take it from main's HEAD,
  // which the factory commits under.
  const identity = (await git(["-C", root, "log", "-1", "--format=%an|%ae", "origin/main"])).trim();
  const [name, email] = identity.split("|");
  const gitIn = (args: readonly string[]) =>
    git(["-C", worktree, "-c", `user.name=${name}`, "-c", `user.email=${email}`, ...args]);
  try {
    await removeWorktreeHolding(branch);
    await git(["-C", root, "worktree", "add", worktree, branch]);
    const rebase = await runHeavyWork({
      label: `git-rebase-${branch}`,
      program: "git",
      args: ["-C", worktree, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "rebase", "origin/main"],
      cwd: root,
      env: nonInteractiveGitEnv(),
      waitSeconds: config.SANDCASTLE_HEAVY_WORK_WAIT_SECONDS,
      timeoutSeconds: config.SANDCASTLE_GIT_TIMEOUT_SECONDS,
      maxTailBytes: GH_MAX_TAIL_BYTES,
    });
    if (rebase.code !== 0) return false;
    await gitIn(["push", "--force-with-lease", "origin", branch]);
    return true;
  } catch {
    try {
      await git(["-C", worktree, "rebase", "--abort"]);
    } catch {
      // no rebase in progress (the worktree may not exist)
    }
    return false;
  } finally {
    try {
      await git(["-C", root, "worktree", "remove", "--force", worktree]);
    } catch {
      // the worktree may not exist if the add failed
    }
  }
}

/** Conflict alerts already sent, keyed by PR and head. */
function readAlertKeys(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(strikesPath().replace("strikes.json", "ci-alerts.json"), "utf8"));
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function writeAlertKeys(keys: Set<string>): void {
  mkdirSync(resolve(root, ".sandcastle/logs"), { recursive: true });
  writeFileSync(
    strikesPath().replace("strikes.json", "ci-alerts.json"),
    `${JSON.stringify([...keys], null, 2)}\n`,
  );
}

/** Rebase every open factory branch onto the latest main and arm green heads. */
async function rebaseOpenPrs(): Promise<void> {
  await git(["-C", root, "fetch", "origin"]);
  const head = (await git(["-C", root, "rev-parse", "origin/main"])).trim();
  for (const pr of await openFactoryPrs()) {
    try {
      if (await rebaseBranch(pr.headRefName)) {
        console.log(`  #${pr.number}: rebased onto main`);
      } else {
        // A conflict that survives the deterministic rebase is reported once
        // per head: a branch left dirty without a human seeing it is the failure
        // mode this monitoring exists to catch.
        const issue = Number(/^sandcastle\/issue-(\d+)$/.exec(pr.headRefName)?.[1] ?? 0);
        const escalation = noRebaseCommitEscalation(pr.number, issue, head, pr.headRefName);
        const keys = readAlertKeys();
        if (!keys.has(escalation.key)) {
          keys.add(escalation.key);
          writeAlertKeys(keys);
          alertOperator(root, escalation.message);
        }
        console.log(`  #${pr.number}: rebase conflicted; escalated to a human`);
      }
      // A green, clean head is armed from the sweep as well as from delivery,
      // so a PR that was already open when this framework landed still merges.
      const armed = armFactoryPr(root, pr.number, autoMergePolicyFromEnv());
      if (armed.action === "armed") console.log(`  #${pr.number}: auto-merge armed`);
    } catch (error) {
      // one bad branch must not take the rest of the pass down
      console.error(`  #${pr.number}: reconcile failed: ${String(error)}`);
    }
  }
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

function resultOutput(result: CommandResult): string {
  return [result.stdout, result.stderr].join("\n").trim();
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
    if (piAgentDir !== null) rmSync(piAgentDir, { recursive: true, force: true });
  });
