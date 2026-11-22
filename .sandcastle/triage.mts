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
import { seatbelt } from "@ai-hero/sandcastle/sandboxes/seatbelt";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { acquireLock } from "./lock.mts";

const root = resolve(process.cwd());
try {
  process.loadEnvFile(resolve(root, ".sandcastle/.env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const config = z
  .object({
    GITHUB_REPO: z.string().default("rubixhacker/komotion"),
    // The agent model.
    SANDCASTLE_MODEL: z.string().default("vllm/Qwen3.8"),
    VLLM_BASE_URL: z.url().default("http://192.168.1.3:18982/v1"),
    // How many issues one triage pass may look at.
    TRIAGE_BATCH: z.coerce.number().int().min(1).max(50).default(20),
  })
  .parse(process.env);

function gh(args: readonly string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function ghJson<T>(args: readonly string[]): T {
  return JSON.parse(gh(args)) as T;
}

interface OpenIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: { author: string; body: string }[];
}

function fetchOpenIssues(): OpenIssue[] {
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

function check(): void {
  const failures: string[] = [];
  try {
    gh(["api", `repos/${config.GITHUB_REPO}`, "--jq", ".full_name"]);
  } catch {
    failures.push(`gh cannot read ${config.GITHUB_REPO}`);
  }
  const model = config.SANDCASTLE_MODEL.split("/")[1] ?? config.SANDCASTLE_MODEL;
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
  if (failures.length > 0) {
    for (const failure of failures) console.error(`triage check: ${failure}`);
    process.exit(1);
  }
  console.log("triage check: environment is ready");
}

if (process.argv.includes("--check")) {
  check();
  process.exit(0);
}

const release = acquireLock(root, "triage");
if (release === null) {
  console.log("triage: another pass is running; not starting a new one");
  process.exit(75);
}

async function main(): Promise<void> {
  const issues = fetchOpenIssues();
  console.log(`triage: ${issues.length} open issue(s)`);
  if (issues.length === 0) {
    console.log("triage: nothing to do");
    return;
  }

  const result = await sandcastle.run({
    sandbox: seatbelt(),
    name: "triage",
    maxIterations: 1,
    agent: sandcastle.opencode(config.SANDCASTLE_MODEL, { captureSessions: false }),
    promptFile: "./.sandcastle/triage-prompt.md",
    promptArgs: {
      ISSUES: JSON.stringify(issues, null, 2),
    },
    output: sandcastle.Output.object({ tag: "triage", schema: decisionSchema }),
    cwd: root,
  });

  const decisions = result.output.decisions;
  console.log(`triage: ${decisions.length} decision(s)`);
  for (const decision of decisions) {
    for (const label of decision.add)
      gh(["label", "add", label, "--repo", config.GITHUB_REPO, String(decision.issue)]);
    for (const label of decision.remove)
      gh(["label", "remove", label, "--repo", config.GITHUB_REPO, String(decision.issue)]);
    if (decision.note)
      gh([
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
}

main()
  .then(() => {
    console.log("triage: pass complete");
  })
  .catch((error) => {
    console.error(`triage: pass failed: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    release();
  });
