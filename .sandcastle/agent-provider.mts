import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";

/** The CLI that writes tickets and repairs branches inside a factory sandbox. */
export const FACTORY_AGENTS = ["pi", "opencode"] as const;
export type FactoryAgent = (typeof FACTORY_AGENTS)[number];
export const DEFAULT_FACTORY_AGENT: FactoryAgent = "pi";

/**
 * Every factory agent disables session capture. The author gets its result from
 * the branch, so capture costs a CLI round trip that changes with every agent
 * upgrade (OpenCode v2 rejects the v1 export command Sandcastle 0.14 uses).
 * Pi defaults to a medium thinking level that some models reject; "off" is
 * mapped to the provider's own no-thinking value in pi's catalog.
 */
export function factoryAgent(
  model: string,
  agent: FactoryAgent,
  env?: Record<string, string>,
) {
  const extra = env === undefined ? {} : { env };
  return agent === "pi"
    ? sandcastle.pi(model, { captureSessions: false, thinking: "off", ...extra })
    : sandcastle.opencode(model, { captureSessions: false, ...extra });
}

/**
 * Pi has no permission system, so the deny list lives in a shell wrapper. Pi
 * starts the bash tool with `$shellPath -c <command>`, which gives the wrapper
 * the whole command, including every link of a compound line. The patterns come
 * from the same OpenCode config the control route uses, so the two cannot drift.
 */
function guardScript(root: string): string {
  const config = JSON.parse(
    readFileSync(join(root, ".sandcastle", "agent", "opencode.json"), "utf8"),
  ) as { readonly permission?: { readonly bash?: Readonly<Record<string, string>> } };
  const denied = Object.entries(config.permission?.bash ?? {})
    .filter(([pattern, rule]) => pattern !== "*" && rule === "deny")
    .map(([pattern]) => pattern);
  if (denied.some((pattern) => /[\n'"]/u.test(pattern)))
    throw new Error("A denied shell pattern contains a quote or a newline");
  return `#!/bin/sh
command=$2
case "$command" in
  ${denied.join("|")})
    printf 'Denied by the factory agent policy: %s\\n' "$command" >&2
    exit 1
    ;;
esac
exec /bin/sh -c "$command"
`;
}

export interface PiAgentDirOptions {
  /** Repository root, used to copy the factory skills into the agent directory. */
  readonly root: string;
  /** Every configured sandbox model: `provider/model` routes to its pi provider. */
  readonly models: readonly string[];
  readonly vllmBaseUrl: string;
  /** Absolute host path of the read-only OpenCode Go key mount. */
  readonly keyPath: string;
}

/**
 * Builds one pi agent directory per pass. It is mounted writable into each
 * sandbox: `skills` are the factory's own skills, `sessions` keeps pi's JSONL
 * state out of the worktree, and `guard.sh` replaces OpenCode's deny list.
 * Paths are absolute because the private sandbox HOME is not the host HOME.
 */
export function createPiAgentDir(options: PiAgentDirOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "komotion-pi-agent-"));
  mkdirSync(join(dir, "sessions"));
  cpSync(resolve(options.root, ".sandcastle", "agent", "skills"), join(dir, "skills"), {
    recursive: true,
  });

  const models = (prefix: string) =>
    options.models.filter((model) => model.startsWith(`${prefix}/`)).map((model) => model.slice(prefix.length + 1));
  const providers: Record<string, unknown> = {
    vllm: {
      baseUrl: options.vllmBaseUrl,
      api: "openai-completions",
      apiKey: "vllm",
      models: models("vllm").map((id) =>
        id === "Qwen3.8"
          ? { id, contextWindow: 229376, maxTokens: 8192, input: ["text", "image"] }
          : { id },
      ),
    },
    // OpenCode Go's models are in pi's catalog; only the credential changes.
    // A `!command` keeps the key on disk instead of exposing it as an env var.
    "opencode-go": { apiKey: `!cat '${options.keyPath.replaceAll("'", "'\\''")}'` },
  };
  const ollama = models("ollama-cloud");
  if (ollama.length > 0)
    providers["ollama-cloud"] = {
      baseUrl: "https://ollama.com/v1",
      api: "openai-completions",
      apiKey: "$OLLAMA_API_KEY",
      models: ollama.map((id) => ({ id })),
    };
  writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers }, null, 2)}\n`);
  writeFileSync(
    join(dir, "settings.json"),
    `${JSON.stringify(
      {
        skills: ["skills"],
        sessionDir: join(dir, "sessions"),
        shellPath: join(dir, "guard.sh"),
        defaultThinkingLevel: "off",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "guard.sh"), guardScript(options.root), { mode: 0o755 });
  return dir;
}

/** Parses pi's `--list-models` table, whose first two columns are provider and model. */
export function piModelAvailable(stdout: string, model: string): boolean {
  return stdout.split("\n").some((line) => {
    const columns = line.trim().split(/\s+/u);
    return columns.length >= 2 && `${columns[0]}/${columns[1]}` === model;
  });
}
