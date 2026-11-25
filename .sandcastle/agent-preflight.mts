import type { ExecResult } from "@ai-hero/sandcastle";
import type { FactoryAgent } from "./agent-provider.mjs";

/**
 * The checks a factory pass runs before it starts any ticket. A pass whose
 * sandbox agent CLI cannot finish a session, or whose delivery push is blocked
 * by the repository hooks, used to continue and fail later with an opaque
 * "no plan" or a delivery that silently never landed (#2442). Every check names
 * the operation that broke so an image or CLI upgrade gets an actionable error
 * at startup instead.
 */

/** OpenCode's CLI needs an export/import round trip; pi's JSONL sessions do not. */
export const AGENT_LIFECYCLE_OPERATIONS_BY_AGENT = {
  pi: ["run"],
  opencode: ["run", "export", "import"],
} as const satisfies Record<FactoryAgent, readonly AgentLifecycleOperation[]>;
/** The agent CLI operations the preflight proves, in order. */
export const AGENT_LIFECYCLE_OPERATIONS = AGENT_LIFECYCLE_OPERATIONS_BY_AGENT.opencode;
export type AgentLifecycleOperation = "run" | "export" | "import";

/** Every check the startup preflight performs. */
export type PreflightCheck = AgentLifecycleOperation | "push";

export interface PreflightResult {
  readonly ok: boolean;
  readonly failedCheck: PreflightCheck | null;
  readonly detail: string;
}

const passed: PreflightResult = { ok: true, failedCheck: null, detail: "" };
const failed = (failedCheck: PreflightCheck, detail: string): PreflightResult => ({
  ok: false,
  failedCheck,
  detail,
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function brief(value: string, limit = 2000): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeFailure(result: ExecResult): string {
  const output = result.stderr.trim() || result.stdout.trim() || "no output";
  return `exit ${result.exitCode}: ${brief(output)}`;
}

export interface AgentLifecycleOptions {
  /** The configured author model the trivial run uses. */
  readonly model: string;
  /** Which agent CLI the sandbox runs; callers must name it explicitly. */
  readonly agent: FactoryAgent;
  /** Where the exported session JSON lands inside the sandbox. */
  readonly exportPath?: string;
  /** The prompt for the trivial run; it must not need any tools. */
  readonly prompt?: string;
}

const DEFAULT_EXPORT_PATH = "/tmp/caff-factory-preflight-session.json";
const DEFAULT_PROMPT = "Reply with OK. Do not use any tools.";

export interface AgentLifecycleCommands {
  readonly run: string;
  /** pi sessions are files in the agent directory, so pi has no export/import commands. */
  readonly exportSession?: (sessionId: string) => string;
  readonly import?: string;
}

/**
 * The shell commands of the round trip. `--archived` keeps the scratch
 * session out of session lists, `--standalone` avoids a background server that
 * a fresh sandbox does not run, and `test -s` makes an empty export a failure
 * rather than an import of nothing. Pi needs only one print-mode run and keeps
 * no session at all (`--no-session`).
 */
export function agentLifecycleCommands(options: AgentLifecycleOptions): AgentLifecycleCommands {
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  if (options.agent === "pi")
    return {
      run: [
        "pi -p --mode json --model",
        shellQuote(options.model),
        "--thinking off --no-session",
        shellQuote(prompt),
      ].join(" "),
    };
  const exportPath = options.exportPath ?? DEFAULT_EXPORT_PATH;
  // A leading `$` is an environment reference, not a literal filename: native
  // sandboxes expose a private writable TMPDIR instead of a shared /tmp.
  const target = exportPath.startsWith("$") ? exportPath : shellQuote(exportPath);
  return {
    run: [
      "opencode run --standalone --archived --auto --format json --model",
      shellQuote(options.model),
      shellQuote(prompt),
    ].join(" "),
    exportSession: (sessionId: string) =>
      `opencode session export --standalone ${shellQuote(sessionId)} > ${target} && test -s ${target}`,
    import: `opencode session import --standalone ${target}`,
  };
}

/** Reads the session id from `opencode run --format json` NDJSON output. */
export function sessionIdFromRun(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    try {
      const event: unknown = JSON.parse(line);
      if (typeof event !== "object" || event === null) continue;
      const sessionId = (event as { readonly sessionID?: unknown }).sessionID;
      if (typeof sessionId === "string" && sessionId.startsWith("ses_")) return sessionId;
    } catch {
      // Plain output is tolerated; only a reported session id can be exported.
    }
  }
  return null;
}

/**
 * The command comes first so a host adapter can ignore the operation, while a
 * test can fail exactly one step of the round trip.
 */
export type AgentLifecycleExecutor = (
  command: string,
  operation: AgentLifecycleOperation,
) => Promise<ExecResult>;

/** Proves a minimal run, export of its session, and import of that export. */
export async function verifyAgentLifecycle(
  execute: AgentLifecycleExecutor,
  options: AgentLifecycleOptions,
): Promise<PreflightResult> {
  const agent = options.agent;
  const commands = agentLifecycleCommands(options);
  const run = await execute(commands.run, "run");
  if (run.exitCode !== 0) return failed("run", describeFailure(run));
  if (agent === "pi") return passed;
  const sessionId = sessionIdFromRun(run.stdout);
  if (sessionId === null)
    return failed(
      "run",
      `run reported no session id to export: ${brief(run.stdout || run.stderr) || "no output"}`,
    );
  const exported = await execute(commands.exportSession?.(sessionId) ?? "", "export");
  if (exported.exitCode !== 0) return failed("export", describeFailure(exported));
  const imported = await execute(commands.import ?? "", "import");
  if (imported.exitCode !== 0) return failed("import", describeFailure(imported));
  return passed;
}

/** A host command that throws on a non-zero exit, like `main.mts`'s `command`. */
export type HostCommand = (args: readonly string[], cwd?: string) => string;

function errorMessage(error: unknown): string {
  return brief(error instanceof Error ? error.message : String(error));
}

/** Push and delete both use the hooks a real factory delivery uses. */
export const PUSH_HOOKS_ARG = ["-c", "core.hooksPath=.githooks"] as const;

export function preflightPushArgs(ref: string): readonly string[] {
  return [...PUSH_HOOKS_ARG, "push", "origin", `HEAD:${ref}`];
}

export function preflightDeleteArgs(ref: string): readonly string[] {
  return [...PUSH_HOOKS_ARG, "push", "origin", `:${ref}`];
}

/**
 * A probe setup or cleanup step. `cwd` is relative to the host checkout when
 * omitted; the push itself must run from the scratch worktree so the hook reads
 * that worktree's HEAD, not the host checkout's.
 */
export interface GitInvocation {
  readonly args: readonly string[];
  readonly cwd?: string;
}

/**
 * The scratch names of the host-side delivery push probe. The probe runs at
 * pass start, at the same time as the planner's preflight sandbox. Sharing any
 * of these names with the planner (`sandcastle/preflight-*`,
 * `refs/sandcastle/preflight-*`, `sandcastle-preflight-*`) once let one step's
 * worktree hold the branch while the probe tried to create it, aborting every
 * pass before a ticket started (#2653). The `push-probe` marker keeps all three
 * distinct. `suffix` makes concurrent probes unique; callers append it to the
 * worktree prefix with `mkdtempSync`.
 */
export function deliveryPushProbeNames(
  runId: string | number,
  suffix: string,
): {
  readonly branch: string;
  readonly ref: string;
  readonly worktreePrefix: string;
} {
  return {
    branch: `sandcastle/push-probe-${runId}-${suffix}`,
    ref: `refs/sandcastle/push-probe-${runId}-${suffix}`,
    worktreePrefix: `sandcastle-push-probe-${runId}-${suffix}-`,
  };
}

export interface DeliveryPushProbeOptions {
  /** Scratch remote ref the probe pushes and deletes. */
  readonly ref: string;
  /** Local branch for the scratch worktree; must use the `sandcastle/` prefix. */
  readonly branch: string;
  /** Filesystem path of the scratch worktree. */
  readonly worktreePath: string;
  /**
   * Commit the scratch branch is based on. It must be strictly behind
   * `origin/main` so the guard's behind-main check is real; `origin/main~1` is
   * one commit behind. Overridable for tests.
   */
  readonly startPoint?: string;
  /**
   * Runs after the worktree is created and before the push. Lets the host stage
   * gitignored inputs the pre-push hook needs (e.g. local.properties). No-op by
   * default.
   */
  readonly afterSetup?: () => void;
}

export interface DeliveryPushProbeCommands {
  readonly setup: GitInvocation;
  readonly push: GitInvocation;
  /** Best-effort teardown, in order: remote ref, worktree, then local branch. */
  readonly cleanup: readonly GitInvocation[];
}

/** The git steps that reproduce a real delivery's hook conditions in a probe. */
export function deliveryPushProbeCommands(
  options: DeliveryPushProbeOptions,
): DeliveryPushProbeCommands {
  const { ref, branch, worktreePath, startPoint = "origin/main~1" } = options;
  return {
    // A `sandcastle/*` branch rooted at origin/main~1 is exactly the state a
    // real delivery worktree has: behind main, so the exemption is what keeps
    // the hook green. Pushing from the host checkout (root) instead would read
    // root's HEAD, where HEAD..origin/main is 0 and every branch-sensitive
    // check passes vacuously (#2442 review).
    setup: { args: ["worktree", "add", "-b", branch, worktreePath, startPoint] },
    push: { args: preflightPushArgs(ref), cwd: worktreePath },
    cleanup: [
      { args: preflightDeleteArgs(ref) },
      { args: ["worktree", "remove", "--force", worktreePath] },
      { args: ["branch", "-D", branch] },
    ],
  };
}

function problemsSuffix(problems: readonly string[]): string {
  return problems.length > 0 ? ` (cleanup: ${problems.join("; ")})` : "";
}

/**
 * Proves the delivery push path under the conditions a real delivery has. The
 * probe creates a scratch worktree on a `sandcastle/` branch behind
 * `origin/main`, pushes one scratch ref through the repository's pre-push hook
 * from that worktree, and removes all scratch state however the check ends. A
 * guard that would block delivery therefore fails here, at pass start, instead
 * of after the reviews and gates have already completed. Teardown is best
 * effort: a step that could not be removed is reported in `detail` but does not
 * fail the pass, because the push path itself was proven.
 */
export function verifyDeliveryPushPath(
  run: HostCommand,
  options: DeliveryPushProbeOptions,
): PreflightResult {
  const commands = deliveryPushProbeCommands(options);

  const cleanup = (): string[] => {
    const problems: string[] = [];
    for (const invocation of commands.cleanup) {
      try {
        run(invocation.args, invocation.cwd);
      } catch (error) {
        problems.push(errorMessage(error));
      }
    }
    return problems;
  };

  try {
    run(commands.setup.args, commands.setup.cwd);
    options.afterSetup?.();
  } catch (error) {
    return failed(
      "push",
      `could not create delivery-push probe worktree: ${errorMessage(error)}${problemsSuffix(cleanup())}`,
    );
  }

  let pushFailure: PreflightResult | null = null;
  try {
    run(commands.push.args, commands.push.cwd);
  } catch (error) {
    pushFailure = failed("push", errorMessage(error));
  }

  const problems = cleanup();
  if (pushFailure !== null)
    return { ...pushFailure, detail: `${pushFailure.detail}${problemsSuffix(problems)}` };
  return problems.length === 0
    ? passed
    : { ok: true, failedCheck: null, detail: problems.join("; ") };
}
