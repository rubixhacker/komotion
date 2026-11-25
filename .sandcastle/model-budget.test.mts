import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
} from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { withModelBudget } from "./model-budget.mjs";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolvePromiseInner) => {
    resolvePromise = resolvePromiseInner;
  });
  return { promise, resolve: () => resolvePromise() };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function within<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function temporaryLockDirectory(): string {
  return mkdtempSync(join(tmpdir(), "sandcastle-model-budget-test-"));
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await within(closed);
}

test("non-vLLM models bypass locks and cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  let calls = 0;
  const result = await withModelBudget(
    "ollama-cloud/deepseek-v4.1-flash:1017",
    async () => {
      calls += 1;
      return "completed";
    },
    { slots: 0, lockDirectory: join(tmpdir(), "unused-model-budget-lock"), signal: controller.signal },
  );
  assert.equal(result, "completed");
  assert.equal(calls, 1);
});

test(
  "two vLLM calls may run while a third waits for a released lease",
  { timeout: 30_000 },
  async () => {
  const root = temporaryLockDirectory();
  const controller = new AbortController();
  const gates = [deferred(), deferred(), deferred()];
  const started = [deferred(), deferred(), deferred()];
  const tasks: Promise<string>[] = [];
  const running = new Set<number>();
  let maximumRunning = 0;

  const start = (index: number) => {
    const task = withModelBudget(
      "vllm/Qwen3.8",
      async () => {
        running.add(index);
        maximumRunning = Math.max(maximumRunning, running.size);
        started[index]?.resolve();
        try {
          await gates[index]?.promise;
          return `result-${index}`;
        } finally {
          running.delete(index);
        }
      },
      { slots: 2, lockDirectory: root, signal: controller.signal },
    );
    tasks.push(task);
  };

  try {
    // Given two held leases, starting a third tree must not run its callback.
    start(0);
    start(1);
    await within(Promise.all([started[0]!.promise, started[1]!.promise]));
    start(2);
    await delay(150);
    assert.equal(running.size, 2);
    assert.equal(tasks.length, 3);
    assert.equal(maximumRunning, 2);

    // When either holder releases, exactly the waiting tree can proceed.
    gates[0]?.resolve();
    await within(started[2]!.promise);
    await within(tasks[0] as Promise<string>);
    assert.equal(running.size, 2);
    assert.equal(maximumRunning, 2);
    assert.equal(await tasks[0], "result-0");

    gates[1]?.resolve();
    gates[2]?.resolve();
    assert.deepEqual(await within(Promise.all(tasks)), ["result-0", "result-1", "result-2"]);
    assert.equal(running.size, 0);
  } finally {
    controller.abort(new Error("test cleanup"));
    for (const gate of gates) gate.resolve();
    await Promise.allSettled(tasks);
    rmSync(root, { recursive: true, force: true });
  }
});

test("aborting a wait rejects with the signal reason without disturbing the owner", async () => {
  const root = temporaryLockDirectory();
  const release = deferred();
  const ownerStarted = deferred();
  const owner = withModelBudget(
    "vllm/Qwen3.8",
    async () => {
      ownerStarted.resolve();
      await release.promise;
    },
    { slots: 1, lockDirectory: root },
  );
  const controller = new AbortController();
  let waiterStarted = false;
  let waiter: Promise<void> | undefined;

  try {
    await within(ownerStarted.promise);
    waiter = withModelBudget(
      "vllm/Qwen3.8",
      async () => {
        waiterStarted = true;
      },
      { slots: 1, lockDirectory: root, signal: controller.signal },
    );
    await delay(100);
    const reason = new Error("cancel waiting for the model");
    controller.abort(reason);
    await assert.rejects(waiter, (error) => error === reason);
    assert.equal(waiterStarted, false);

    release.resolve();
    await within(owner);
    await withModelBudget("vllm/Qwen3.8", async () => {}, {
      slots: 1,
      lockDirectory: root,
    });
  } finally {
    controller.abort(new Error("test cleanup"));
    release.resolve();
    await Promise.allSettled([owner, ...(waiter ? [waiter] : [])]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("normal release and callback failure both allow immediate reacquisition", async () => {
  const root = temporaryLockDirectory();
  try {
    const first = await withModelBudget("vllm/Qwen3.8", async () => 42, {
      slots: 1,
      lockDirectory: root,
    });
    assert.equal(first, 42);
    const second = await withModelBudget("vllm/Qwen3.8", async () => "reacquired", {
      slots: 1,
      lockDirectory: root,
    });
    assert.equal(second, "reacquired");

    const failure = new Error("model work failed");
    await assert.rejects(
      withModelBudget(
        "vllm/Qwen3.8",
        async () => {
          throw failure;
        },
        { slots: 1, lockDirectory: root },
      ),
      (error) => error === failure,
    );
    const afterFailure = await within(
      withModelBudget("vllm/Qwen3.8", async () => "holder cleaned up", {
        slots: 1,
        lockDirectory: root,
      }),
    );
    assert.equal(afterFailure, "holder cleaned up");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function ownerPid(
  owner: ChildProcessByStdio<null, Readable, Readable>,
  diagnostics: () => string,
) {
  let output = "";
  let spawnError: Error | undefined;
  owner.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  owner.once("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const match = /MODEL_BUDGET_OWNER=(\d+)/.exec(output);
    if (match?.[1]) return Number(match[1]);
    if (spawnError) throw spawnError;
    if (owner.exitCode !== null || owner.signalCode !== null) {
      throw new Error(`Lock owner exited before readiness: ${diagnostics()}`);
    }
    await delay(20);
  }
  throw new Error(`Lock owner did not become ready: ${diagnostics()}`);
}

test(
  "a SIGKILLed cross-process owner releases its kernel lease through holder stdin EOF",
  { timeout: 15_000 },
  async () => {
    const root = temporaryLockDirectory();
    const script = join(root, "owner.mts");
    const moduleUrl = new URL("./model-budget.mts", import.meta.url).href;
    const tsxCli = fileURLToPath(new URL("./node_modules/tsx/dist/cli.mjs", import.meta.url));
    writeFileSync(
      script,
      `import { withModelBudget } from ${JSON.stringify(moduleUrl)};\n` +
        `await withModelBudget("vllm/Qwen3.8", async () => {\n` +
        `  console.log("MODEL_BUDGET_OWNER=" + process.pid);\n` +
        "  setInterval(() => {}, 1000);\n" +
        "  await new Promise(() => {});\n" +
        `}, { slots: 1, lockDirectory: ${JSON.stringify(root)} });\n`,
    );
    const owner = spawn(process.execPath, [tsxCli, script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    owner.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-8_192);
    });
    const controller = new AbortController();
    let waiter: Promise<string> | undefined;

    try {
      const pid = await ownerPid(owner, () => diagnostics);
      waiter = withModelBudget("vllm/Qwen3.8", async () => "acquired after SIGKILL", {
        slots: 1,
        lockDirectory: root,
        signal: controller.signal,
      });
      await delay(150);

      const closed = once(owner, "close");
      process.kill(pid, "SIGKILL");
      await within(closed);
      assert.equal(await within(waiter), "acquired after SIGKILL");
    } finally {
      controller.abort(new Error("test cleanup"));
      if (waiter) await Promise.allSettled([waiter]);
      await stopProcess(owner);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
