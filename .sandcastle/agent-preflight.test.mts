import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecResult } from "@ai-hero/sandcastle";
import {
  AGENT_LIFECYCLE_OPERATIONS,
  agentLifecycleCommands,
  deliveryPushProbeCommands,
  deliveryPushProbeNames,
  preflightDeleteArgs,
  preflightPushArgs,
  sessionIdFromRun,
  verifyAgentLifecycle,
  verifyDeliveryPushPath,
  type AgentLifecycleOperation,
  type AgentLifecycleExecutor,
} from "./agent-preflight.mjs";

const SESSION_ID = "ses_preflight_test";
const runStdout = `${JSON.stringify({ type: "step_start" })}\n${JSON.stringify({ sessionID: SESSION_ID })}\n`;

type FakeCall = { readonly operation: AgentLifecycleOperation; readonly command: string };

function fakeLifecycle(overrides: Partial<Record<AgentLifecycleOperation, ExecResult>> = {}) {
  const calls: FakeCall[] = [];
  const execute: AgentLifecycleExecutor = async (command, operation) => {
    calls.push({ operation, command });
    if (operation in overrides) return overrides[operation] as ExecResult;
    return { exitCode: 0, stdout: operation === "run" ? runStdout : "", stderr: "" };
  };
  return { execute, calls };
}

test("a healthy agent CLI passes the whole round trip in run, export, import order", async () => {
  const { execute, calls } = fakeLifecycle();
  const result = await verifyAgentLifecycle(execute, { model: "vendor/model", agent: "opencode" });
  assert.deepEqual(result, { ok: true, failedCheck: null, detail: "" });
  assert.deepEqual(
    calls.map((call) => call.operation),
    [...AGENT_LIFECYCLE_OPERATIONS],
  );
  assert.match(calls[0]?.command ?? "", /--model 'vendor\/model'/u);
  assert.match(calls[1]?.command ?? "", /ses_preflight_test/u);
  assert.match(calls[2]?.command ?? "", /session import/u);
});

test("a broken run is named and stops the round trip", async () => {
  const { execute, calls } = fakeLifecycle({
    run: { exitCode: 1, stdout: "", stderr: "model not found" },
  });
  const result = await verifyAgentLifecycle(execute, { model: "vendor/model", agent: "opencode" });
  assert.equal(result.ok, false);
  assert.equal(result.failedCheck, "run");
  assert.match(result.detail, /model not found/u);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["run"],
  );
});

test("a run with no reported session id is a broken run", async () => {
  const { execute, calls } = fakeLifecycle({
    run: { exitCode: 0, stdout: "plain text\n", stderr: "" },
  });
  const result = await verifyAgentLifecycle(execute, { model: "vendor/model", agent: "opencode" });
  assert.equal(result.failedCheck, "run");
  assert.match(result.detail, /no session id/u);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["run"],
  );
});

test("a broken export is named and import is not attempted", async () => {
  const { execute, calls } = fakeLifecycle({
    export: { exitCode: 2, stdout: "", stderr: "export refused" },
  });
  const result = await verifyAgentLifecycle(execute, { model: "vendor/model", agent: "opencode" });
  assert.equal(result.failedCheck, "export");
  assert.match(result.detail, /export refused/u);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["run", "export"],
  );
});

test("a broken import is named after all three operations ran", async () => {
  const { execute, calls } = fakeLifecycle({
    import: { exitCode: 3, stdout: "", stderr: "import refused" },
  });
  const result = await verifyAgentLifecycle(execute, { model: "vendor/model", agent: "opencode" });
  assert.equal(result.failedCheck, "import");
  assert.match(result.detail, /import refused/u);
  assert.deepEqual(
    calls.map((call) => call.operation),
    [...AGENT_LIFECYCLE_OPERATIONS],
  );
});

test("the round trip commands quote paths, prompts and session ids", () => {
  const commands = agentLifecycleCommands({
    model: "vllm/Qwen3.8",
    agent: "opencode",
    exportPath: "/tmp/x y.json",
    prompt: "It's OK",
  });
  assert.match(commands.run, /--archived/u);
  assert.match(commands.run, /--standalone/u);
  assert.equal(commands.run.includes("It'\\''s OK"), true);
  assert.match(commands.exportSession?.("ses_x") ?? "", /'ses_x'/u);
  assert.match(commands.exportSession?.("ses_x") ?? "", /test -s '\/tmp\/x y\.json'/u);
  assert.equal(commands.import, "opencode session import --standalone '/tmp/x y.json'");
});

test("pi preflight proves one print run and no session round trip", async () => {
  const commands = agentLifecycleCommands({ model: "vllm/Qwen3.8", agent: "pi" });
  assert.match(commands.run, /^pi -p --mode json --model /u);
  assert.match(commands.run, /--no-session/u);
  assert.equal(commands.exportSession, undefined);
  assert.equal(commands.import, undefined);

  const { execute, calls } = fakeLifecycle();
  const result = await verifyAgentLifecycle(execute, { model: "vllm/Qwen3.8", agent: "pi" });
  assert.deepEqual(result, { ok: true, failedCheck: null, detail: "" });
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["run"],
  );
});

test("only a reported session id is accepted from run output", () => {
  assert.equal(sessionIdFromRun(runStdout), SESSION_ID);
  assert.equal(sessionIdFromRun("not json\n"), null);
  assert.equal(sessionIdFromRun(JSON.stringify({ sessionID: 42 })), null);
  assert.equal(sessionIdFromRun(JSON.stringify({ sessionID: "not-prefixed" })), null);
});

test("the delivery-push probe names can never collide with the planner preflight names", () => {
  const runIds = ["0", "7", "1700000000000", "run-1"];
  const suffixes = ["abc123", "", "preflight", "x-y_z"];
  for (const runId of runIds) {
    // The planner and other preflight steps own these fixed names for a run.
    const planner = {
      branch: `sandcastle/preflight-${runId}`,
      ref: `refs/sandcastle/preflight-${runId}`,
      worktreePrefix: `sandcastle-preflight-${runId}-`,
    };
    for (const suffix of suffixes) {
      const probe = deliveryPushProbeNames(runId, suffix);
      // All three probe scratch names differ from all three planner names,
      // whatever the run id and random suffix happen to be.
      for (const [probeLabel, probeName] of Object.entries(probe)) {
        for (const [plannerLabel, plannerName] of Object.entries(planner)) {
          assert.notEqual(
            probeName,
            plannerName,
            `probe ${probeLabel} (${probeName}) must not equal planner ${plannerLabel} (${plannerName})`,
          );
        }
      }
      // Configuring the probe back onto the preflight names fails these guards
      // even in a case where a suffix kept the raw strings unequal.
      assert.equal(probe.branch.startsWith("sandcastle/preflight-"), false);
      assert.equal(probe.ref.startsWith("refs/sandcastle/preflight-"), false);
      assert.equal(probe.worktreePrefix.startsWith("sandcastle-preflight-"), false);
    }
  }
});

test("the probe is set up on a sandcastle branch behind origin/main and pushes from the worktree", () => {
  const options = {
    ref: "refs/sandcastle/preflight-7",
    branch: "sandcastle/preflight-7",
    worktreePath: "/tmp/sandcastle-preflight-7",
  };
  const commands = deliveryPushProbeCommands(options);
  // A `sandcastle/*` branch at origin/main~1 is the state a real delivery has:
  // behind main, so the stale-branch exemption is what keeps the hook green.
  assert.deepEqual(commands.setup.args, [
    "worktree",
    "add",
    "-b",
    "sandcastle/preflight-7",
    "/tmp/sandcastle-preflight-7",
    "origin/main~1",
  ]);
  assert.equal(commands.setup.cwd, undefined);
  assert.deepEqual(commands.push.args, preflightPushArgs(options.ref));
  assert.equal(commands.push.cwd, options.worktreePath);
  assert.deepEqual(
    commands.cleanup.map((invocation) => invocation.args),
    [
      preflightDeleteArgs(options.ref),
      ["worktree", "remove", "--force", options.worktreePath],
      ["branch", "-D", options.branch],
    ],
  );
  assert.deepEqual(preflightPushArgs(options.ref), [
    "-c",
    "core.hooksPath=.githooks",
    "push",
    "origin",
    `HEAD:${options.ref}`,
  ]);
});

test("a healthy scratch push runs through hooks from the worktree and all scratch state is removed", () => {
  const calls: Array<{ readonly args: string[]; readonly cwd: string | undefined }> = [];
  const names = deliveryPushProbeNames("1", "abc123");
  const { ref, branch } = names;
  const worktreePath = `/tmp/${names.worktreePrefix}`;
  const result = verifyDeliveryPushPath(
    (args, cwd) => {
      calls.push({ args: [...args], cwd });
      return "";
    },
    { ref, branch, worktreePath },
  );
  assert.deepEqual(result, { ok: true, failedCheck: null, detail: "" });
  assert.deepEqual(calls, [
    { args: ["worktree", "add", "-b", branch, worktreePath, "origin/main~1"], cwd: undefined },
    { args: preflightPushArgs(ref), cwd: worktreePath },
    { args: preflightDeleteArgs(ref), cwd: undefined },
    { args: ["worktree", "remove", "--force", worktreePath], cwd: undefined },
    { args: ["branch", "-D", branch], cwd: undefined },
  ]);
});

test("a hook that blocks the push fails at startup and all scratch state is still removed", () => {
  const calls: Array<{ readonly args: string[]; readonly cwd: string | undefined }> = [];
  const ref = "refs/sandcastle/preflight-2";
  const branch = "sandcastle/preflight-2";
  const worktreePath = "/tmp/sandcastle-preflight-2";
  const result = verifyDeliveryPushPath(
    (args, cwd) => {
      calls.push({ args: [...args], cwd });
      if (args.join(" ") === preflightPushArgs(ref).join(" "))
        throw new Error("stale-branch: blocked");
      return "";
    },
    { ref, branch, worktreePath },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedCheck, "push");
  assert.match(result.detail, /stale-branch: blocked/u);
  assert.deepEqual(calls, [
    { args: ["worktree", "add", "-b", branch, worktreePath, "origin/main~1"], cwd: undefined },
    { args: preflightPushArgs(ref), cwd: worktreePath },
    { args: preflightDeleteArgs(ref), cwd: undefined },
    { args: ["worktree", "remove", "--force", worktreePath], cwd: undefined },
    { args: ["branch", "-D", branch], cwd: undefined },
  ]);
});

test("a worktree that cannot be created is reported and cleanup is still attempted", () => {
  const calls: string[][] = [];
  const ref = "refs/sandcastle/preflight-3";
  const result = verifyDeliveryPushPath(
    (args) => {
      calls.push([...args]);
      if (args[0] === "worktree" && args[1] === "add") throw new Error("worktree add refused");
      return "";
    },
    { ref, branch: "sandcastle/preflight-3", worktreePath: "/tmp/sandcastle-preflight-3" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedCheck, "push");
  assert.match(result.detail, /worktree add refused/u);
  assert.ok(calls.some((args) => args.join(" ") === preflightDeleteArgs(ref).join(" ")));
  assert.ok(calls.some((args) => args[0] === "worktree" && args[1] === "remove"));
  assert.ok(calls.some((args) => args[0] === "branch" && args[1] === "-D"));
});

test("afterSetup stages inputs after the worktree exists and before the push", () => {
  const calls: string[][] = [];
  const ref = "refs/sandcastle/preflight-5";
  const worktreePath = "/tmp/sandcastle-preflight-5";
  let afterSetupRan = false;
  verifyDeliveryPushPath(
    (args) => {
      calls.push([...args]);
      if (args[0] === "worktree" && args[1] === "add") {
        // afterSetup must not run before the worktree exists.
        assert.equal(afterSetupRan, false);
      }
      if (args.join(" ") === preflightPushArgs(ref).join(" ")) {
        // afterSetup must have staged inputs before the hook runs.
        assert.equal(afterSetupRan, true);
      }
      return "";
    },
    {
      ref,
      branch: "sandcastle/preflight-5",
      worktreePath,
      afterSetup: () => {
        afterSetupRan = true;
      },
    },
  );
  assert.equal(afterSetupRan, true);
  assert.equal(calls[0]?.[0], "worktree");
  assert.equal(calls[1]?.join(" "), preflightPushArgs(ref).join(" "));
});

test("a cleanup failure after a healthy push is reported but does not fail the pass", () => {
  const ref = "refs/sandcastle/preflight-4";
  const result = verifyDeliveryPushPath(
    (args) => {
      if (args.join(" ") === preflightDeleteArgs(ref).join(" "))
        throw new Error("ref delete refused");
      return "";
    },
    { ref, branch: "sandcastle/preflight-4", worktreePath: "/tmp/sandcastle-preflight-4" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.failedCheck, null);
  assert.match(result.detail, /ref delete refused/u);
});
