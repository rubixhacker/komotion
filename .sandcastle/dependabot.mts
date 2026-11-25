// Dependabot pass: merge green dependency pull requests.
//
// One invocation is one pass. The launchd dependabot lane calls it every 30
// minutes and on GitHub dispatch events. A dependabot pull request merges
// once the repository's CI is green on its head; a red or pending head is
// left for the next pass, and a red head is commented on once.
//
// Usage:
//   npx tsx .sandcastle/dependabot.mts          # run one pass
//   npx tsx .sandcastle/dependabot.mts --check  # verify the environment, then exit

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enterFactoryLock, factoryLockPath } from "./lock.mjs";

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

interface DependabotPr {
  number: number;
  title: string;
  headRefName: string;
  isDraft: boolean;
}

const RED_MARKER = "Sandcastle: CI is red on this head";

function check(): void {
  try {
    gh(["api", `repos/${config.GITHUB_REPO}`, "--jq", ".full_name"]);
  } catch {
    console.error(`dependabot check: gh cannot read ${config.GITHUB_REPO}`);
    process.exit(1);
  }
  console.log("dependabot check: environment is ready");
}

if (process.argv.includes("--check")) {
  check();
  process.exit(0);
}

enterFactoryLock(factoryLockPath("dependabot.lock"), fileURLToPath(import.meta.url));

type CheckState = "green" | "red" | "pending";

/** The CI verdict on a pull request's head: green, red or pending. */
function checkState(prNumber: number): CheckState {
  const checks = ghJson<{ state: string }[]>([
    "pr",
    "checks",
    String(prNumber),
    "--repo",
    config.GITHUB_REPO,
    "--json",
    "state",
  ]);
  if (checks.some((check) => check.state === "FAILURE")) return "red";
  if (checks.some((check) => check.state === "PENDING")) return "pending";
  return "green";
}

async function main(): Promise<void> {
  const prs = ghJson<DependabotPr[]>([
    "pr",
    "list",
    "--repo",
    config.GITHUB_REPO,
    "--author",
    "dependabot[bot]",
    "--state",
    "open",
    "--json",
    "number,title,headRefName,isDraft",
  ]);
  console.log(`dependabot: ${prs.length} open pull request(s)`);
  for (const pr of prs) {
    if (pr.isDraft) {
      console.log(`  #${pr.number}: draft; waiting`);
      continue;
    }
    const state = checkState(pr.number);
    if (state === "green") {
      gh(["pr", "merge", String(pr.number), "--squash", "--repo", config.GITHUB_REPO]);
      console.log(`  #${pr.number}: merged (CI green)`);
    } else if (state === "red") {
      // Comment once: a red head is left for the next pass, and dependabot
      // itself re-runs CI on every base update.
      const comments = ghJson<{ body: string }[]>([
        "issue",
        "comments",
        "--repo",
        config.GITHUB_REPO,
        String(pr.number),
        "--json",
        "body",
      ]);
      if (!comments.some((comment) => comment.body.includes(RED_MARKER))) {
        gh([
          "issue",
          "comment",
          "--repo",
          config.GITHUB_REPO,
          "--body",
          `${RED_MARKER}. The pass will retry on the next run.`,
          String(pr.number),
        ]);
      }
      console.log(`  #${pr.number}: CI red; left for the next pass`);
    } else {
      console.log(`  #${pr.number}: CI pending; waiting`);
    }
  }
}

main()
  .then(() => {
    console.log("dependabot: pass complete");
  })
  .catch((error) => {
    console.error(`dependabot: pass failed: ${String(error)}`);
    process.exitCode = 1;
  })

