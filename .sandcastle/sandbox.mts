import * as sandcastle from "@ai-hero/sandcastle";
import type { CreateSandboxOptions } from "@ai-hero/sandcastle";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Names the library will copy from `.sandcastle/.env` into every container
 * unless the sandbox env overrides them. The override has to be explicit:
 * sandcastle merges that file in after the caller's env.
 */
const SECRET_ENV_PATTERN = /TOKEN|SECRET|PASSWORD|API_KEY|DB_URL|DATABASE_URL/;

export function deniedSandboxEnv(
  envFileKeys: readonly string[],
): Record<string, string> {
  const denied = new Set(envFileKeys.filter((key) => SECRET_ENV_PATTERN.test(key)));
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "SUBQ_API_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_DB_PASSWORD",
    "MOBAI_API_KEY",
    "MOBAI_TAILSCALE_KEY",
    "ANTHROPIC_API_KEY",
    "OLLAMA_API_KEY",
  ]) {
    denied.add(key);
  }
  return Object.fromEntries([...denied].map((key) => [key, ""]));
}

function envFileKeys(root: string): string[] {
  try {
    return readFileSync(resolve(root, ".sandcastle/.env"), "utf8")
      .split("\n")
      .flatMap((line) => {
        const match = /^([A-Z0-9_]+)=/.exec(line);
        return match?.[1] ? [match[1]] : [];
      });
  } catch {
    return [];
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Variables every factory container gets beneath its provider's own. Gradle
// resolves Robolectric's android-all runtime jars from Maven Central
// (settings.gradle.kts), and repo.maven.apache.org answering HTTP 429 stalled
// sandbox test runs for 10 to 30 minutes (#2003, #1606, #1873); Google's mirror
// serves the same artifacts.
export const FACTORY_SANDBOX_ENV: Readonly<Record<string, string>> = {
  ROBOLECTRIC_DEPENDENCY_REPO_URL:
    "https://maven-central.storage-download.googleapis.com/maven2",
};

/**
 * The only credentials a caller may hand a sandbox, and only by naming them:
 * the stall-fallback author's provider key (`stall-fallback.mts`).
 */
export const ALLOWED_SANDBOX_SECRETS: readonly string[] = ["OLLAMA_API_KEY"];

/**
 * The shell command that copies `source` to `path` in a worktree. A directory
 * is copied with what it holds, and into the directory when it already exists
 * there: the agents' tools are one (`agent/`), and a plain `cp` refused it,
 * which failed every pass at start-up on 15 November.
 */
export function copyCommand(source: string, path: string): string {
  if (statSync(source).isDirectory())
    return `mkdir -p ${shellQuote(path)} && cp -R -- ${shellQuote(`${source}/.`)} ${shellQuote(path)}`;
  return `mkdir -p ${shellQuote(dirname(path))} && cp -- ${shellQuote(source)} ${shellQuote(path)}`;
}

/**
 * The host command that stages a fresh worktree's gitignored build inputs.
 *
 * The script is invoked by absolute path from the host checkout and given the
 * worktree (the host hook's cwd) as an explicit target. The hook runs with the
 * worktree as its cwd, so a bare `bash scripts/ci/prepare-local-inputs.sh`
 * would run the branch's copy instead of the trusted host copy; that branch
 * script could then read host files such as `.sandcastle/.env` with the host
 * user's permissions. Running the host checkout's copy keeps the boundary: no
 * branch code runs on the host, and all three inputs land in the worktree
 * before the agent's first build. `CAFF_LOCAL_INPUTS_DIR` points at the host
 * checkout that holds the real `local.properties`, `Keys.xcconfig` and
 * `google-services.json`.
 */
export function prepareLocalInputsCommand(hostRoot: string): string {
  const script = resolve(hostRoot, "scripts/ci/prepare-local-inputs.sh");
  return `CAFF_LOCAL_INPUTS_DIR=${shellQuote(hostRoot)} bash ${shellQuote(script)} "$(pwd)"`;
}

/**
 * Host command that activates the repository's hooks for a fresh worktree.
 *
 * A linked worktree shares the repository's git config, and git runs an
 * executable `core.hooksPath` relative to the worktree the push starts in. Setting
 * it once here makes `.githooks/pre-push` — and the guards it calls — active for
 * every push from this and later worktrees without any manual `git config`.
 * This must run on the host: from inside the sandbox the common `.git/config` is
 * read-only, so an agent's own `git config` cannot activate the hook.
 */
export const ACTIVATE_PUSH_HOOKS_COMMAND = "git config --local core.hooksPath .githooks";

export function createFactorySandbox(
  options: CreateSandboxOptions & { readonly allowSecretEnv?: readonly string[] },
) {
  const { allowSecretEnv = [], ...sandboxOptions } = options;
  for (const key of allowSecretEnv) {
    if (!ALLOWED_SANDBOX_SECRETS.includes(key))
      throw new Error(`${key} may never be passed to a factory sandbox`);
  }
  const root = resolve(options.cwd ?? process.cwd());
  const copyHooks = (options.copyToWorktree ?? [])
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ command: copyCommand(resolve(root, path), path) }));
  // Stage local inputs from the trusted host checkout on worktree setup so the
  // first build needs no manual step. The guard and the command both use that
  // checkout's copy; a branch that adds, deletes or changes its own copy has no
  // effect on what the host executes.
  const localInputsHooks = existsSync(resolve(root, "scripts/ci/prepare-local-inputs.sh"))
    ? [{ command: prepareLocalInputsCommand(root) }]
    : [];
  const callerEnv = options.sandbox.env ?? {};
  const denied = Object.fromEntries(
    Object.entries(deniedSandboxEnv(envFileKeys(root))).filter(
      ([key]) => !allowSecretEnv.includes(key),
    ),
  );
  for (const key of Object.keys(denied)) {
    if (callerEnv[key]) {
      throw new Error(`Refusing to inject ${key} into a factory sandbox`);
    }
  }
  return sandcastle.createSandbox({
    ...sandboxOptions,
    sandbox: {
      ...options.sandbox,
      // Blank secrets last so they win over both the caller and the library's
      // automatic `.sandcastle/.env` injection.
      env: {
        ...FACTORY_SANDBOX_ENV,
        ...callerEnv,
        ...denied,
      },
    },
    copyToWorktree: [],
    hooks: {
      ...options.hooks,
      host: {
        ...options.hooks?.host,
        onWorktreeReady: [
          ...copyHooks,
          { command: ACTIVATE_PUSH_HOOKS_COMMAND },
          ...localInputsHooks,
          ...(options.hooks?.host?.onWorktreeReady ?? []),
        ],
      },
    },
  });
}
