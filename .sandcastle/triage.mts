// Triage pass: classify open issues and apply the repository's triage labels.
//
// One invocation is one pass. The launchd triage lane calls it every hour;
// the lock keeps a new pass from starting while another is running.
//
// The triage agent decides, per issue, which labels to add and remove; the
// host applies them, so the sandbox never holds a GitHub credential.
//
// Usage:
//   npx tsx .sandcastle/triage.mts          # run one pass
//   npx tsx .sandcastle/triage.mts --check  # verify the environment, then exit

import * as sandcastle from "@ai-hero/sandcastle";
import { z } from "zod";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enterFactoryLock, factoryLockPath } from "./lock.mjs";
import { ghCommandFailures, GH_MAX_TAIL_BYTES, promptArgFailures } from "./check.mts";
import { factorySandbox } from "./macos.mts";
import { command, commandJson } from "./process.mts";
import {
  createPiAgentDir,
  factoryAgent,
  FACTORY_AGENTS,
  DEFAULT_FACTORY_AGENT,
} from "./agent-provider.mjs";
import { acknowledgeEvents, pendingEvents } from "./events.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".sandcastle/.env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const config = z
  .object({
    GITHUB_REPO: z.string().default("rubixhacker/komotion"),
    // The agent model and CLI. Pi is the default; OpenCode is the control route.
    SANDCASTLE_MODEL: z.string().default("vllm/Qwen3.8"),
    SANDCASTLE_AGENT: z.enum(FACTORY_AGENTS).default(DEFAULT_FACTORY_AGENT),
    VLLM_BASE_URL: z.url().default("http://192.168.1.3:18982/v1"),
    // How many issues one triage pass may look at.
    TRIAGE_BATCH: z.coerce.number().int().min(1).max(50).default(20),
  })
  .parse(process.env);

async function gh(args: readonly string[]): Promise<string> {
  return command("gh", [...args], { maxTailBytes: GH_MAX_TAIL_BYTES, timeoutMs: 120_000 });
}

async function ghJson<T>(args: readonly string[]): Promise<T> {
  return commandJson<T>("gh", [...args], { maxTailBytes: GH_MAX_TAIL_BYTES, timeoutMs: 120_000 });
}

async function addLabel(issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--add-label", label, "--repo", config.GITHUB_REPO]);
}

async function removeLabel(issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--remove-label", label, "--repo", config.GITHUB_REPO]);
}

interface OpenIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: { author: string; body: string }[];
}

async function fetchOpenIssues(): Promise<OpenIssue[]> {
  return ghJson<OpenIssue[]>([
    "issue",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--state",
    "open",
    "--limit",
    String(config.TRIAGE_BATCH),
    "--json",
    "number,title,body,labels,comments",
    "--jq",
    '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[] | {author: .author.login, body: .body}]}]',
  ]);
}

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      issue: z.number(),
      add: z.array(z.string()).default([]),
      remove: z.array(z.string()).default([]),
      note: z.string().optional(),
    }),
  ),
});

// The gh subcommands the host issues. The check validates each one exists
// in the installed gh, so an invalid subcommand is caught before a pass
// spends agent time on it.
const GH_COMMANDS: readonly (readonly string[])[] = [
  ["api"],
  ["issue", "list"],
  ["issue", "edit"],
  ["issue", "comment"],
];

// The prompt arguments the triage run passes. The check validates the keys
// against the built-in prompt arguments the runtime injects itself, so the
// run cannot collide with one before it starts.
function triagePromptArgs(issues: OpenIssue[]): Record<string, string> {
  return { ISSUES: JSON.stringify(issues, null, 2) };
}

async function check(): Promise<void> {
  const failures: string[] = [];
  try {
    await gh(["api", `repos/${config.GITHUB_REPO}`, "--jq", ".full_name"]);
  } catch {
    failures.push(`gh cannot read ${config.GITHUB_REPO}`);
  }
  failures.push(...(await ghCommandFailures(GH_COMMANDS)));
  failures.push(...promptArgFailures([["triage", triagePromptArgs([])]]));
  const model = config.SANDCASTLE_MODEL.split("/")[1] ?? config.SANDCASTLE_MODEL;
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
  try {
    await command("opencode", ["--version"], { timeoutMs: 30_000 });
  } catch {
    failures.push("opencode is not on PATH");
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`triage check: ${failure}`);
    process.exit(1);
  }
  console.log("triage check: environment is ready");
}

if (process.argv.includes("--check")) {
  await check();
  process.exit(0);
}

enterFactoryLock(factoryLockPath("triage.lock"), fileURLToPath(import.meta.url));

// The lane is woken by an event marker; this pass reads all open issues, so
// the marker has served its purpose and must not wake a second pass.
const triageEvents = resolve(root, ".sandcastle/logs/triage-events");
acknowledgeEvents(triageEvents, pendingEvents(triageEvents));

async function main(): Promise<void> {
  const issues = await fetchOpenIssues();
  console.log(`triage: ${issues.length} open issue(s)`);
  if (issues.length === 0) {
    console.log("triage: nothing to do");
    return;
  }

  const piAgentDir =
    config.SANDCASTLE_AGENT === "pi"
      ? createPiAgentDir({
          root,
          models: [config.SANDCASTLE_MODEL],
          vllmBaseUrl: config.VLLM_BASE_URL,
          keyPath: resolve(process.env.HOME ?? "", ".config/sandcastle/opencode-go.key"),
        })
      : null;
  const result = await sandcastle.run({
    sandbox: await factorySandbox(
      piAgentDir === null
        ? []
        : [{ hostPath: piAgentDir, sandboxPath: piAgentDir, readonly: false }],
    ),
    name: "triage",
    maxIterations: 1,
    agent: factoryAgent(config.SANDCASTLE_MODEL, config.SANDCASTLE_AGENT, {
      OPENCODE_CONFIG_CONTENT: readFileSync(resolve(root, ".sandcastle/opencode.json"), "utf8"),
      VLLM_BASE_URL: config.VLLM_BASE_URL,
      ...(piAgentDir === null ? {} : { PI_CODING_AGENT_DIR: piAgentDir }),
    }),
    promptFile: "./.sandcastle/triage-prompt.md",
    promptArgs: triagePromptArgs(issues),
    output: sandcastle.Output.object({ tag: "triage", schema: decisionSchema }),
    cwd: root,
  });

  const decisions = result.output.decisions;
  console.log(`triage: ${decisions.length} decision(s)`);
  for (const decision of decisions) {
    for (const label of decision.add) await addLabel(decision.issue, label);
    for (const label of decision.remove) await removeLabel(decision.issue, label);
    if (decision.note)
      await gh([
        "issue",
        "comment",
        "--repo",
        config.GITHUB_REPO,
        "--body",
        decision.note,
        String(decision.issue),
      ]);
    console.log(
      `  #${decision.issue}: +[${decision.add.join(", ")}] -[${decision.remove.join(", ")}]`,
    );
  }
  if (piAgentDir !== null) rmSync(piAgentDir, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log("triage: pass complete");
  })
  .catch((error) => {
    console.error(`triage: pass failed: ${String(error)}`);
    process.exitCode = 1;
  });
