import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPiAgentDir,
  DEFAULT_FACTORY_AGENT,
  FACTORY_AGENTS,
  factoryAgent,
  piModelAvailable,
} from "./agent-provider.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("the factory agent switch defaults to pi and accepts only known providers", () => {
  assert.equal(DEFAULT_FACTORY_AGENT, "pi");
  assert.deepEqual([...FACTORY_AGENTS], ["pi", "opencode"]);
});

test("agent selection builds a print-mode provider that never captures sessions", () => {
  const pi = factoryAgent("vllm/Qwen3.8", "pi");
  assert.equal(pi.name, "pi");
  assert.equal(pi.captureSessions, false);
  const print = pi.buildPrintCommand({ prompt: "hi", dangerouslySkipPermissions: false });
  assert.match(print.command, /^pi -p --mode json --model /u);
  assert.match(print.command, /--thinking off/u);
  assert.equal(print.stdin, "hi");

  const opencode = factoryAgent("opencode-go/hy4-flash-free", "opencode");
  assert.equal(opencode.name, "opencode");
  assert.equal(opencode.captureSessions, false);
  assert.match(
    opencode.buildPrintCommand({ prompt: "hi", dangerouslySkipPermissions: false }).command,
    /^opencode run /u,
  );
});

test("pi agent config keeps the key as a file-backed command and mirrors the denied shell commands", () => {
  const dir = createPiAgentDir({
    root,
    models: [
      "vllm/Qwen3.8",
      "opencode-go/hy4-flash-free",
      "ollama-cloud/deepseek-v4.1-flash:1017",
    ],
    vllmBaseUrl: "http://vllm.example/v1",
    keyPath: "/keys/opencode-go.key",
  });
  try {
    const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
    assert.equal(models.providers.vllm.baseUrl, "http://vllm.example/v1");
    assert.deepEqual(
      models.providers.vllm.models.map((model: { id: string }) => model.id),
      ["Qwen3.8"],
    );
    assert.equal(models.providers["opencode-go"].apiKey, "!cat '/keys/opencode-go.key'");
    assert.equal(models.providers["ollama-cloud"].baseUrl, "https://ollama.com/v1");
    assert.deepEqual(
      models.providers["ollama-cloud"].models.map((model: { id: string }) => model.id),
      ["deepseek-v4.1-flash:1017"],
    );

    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    assert.deepEqual(settings.skills, ["skills"]);
    assert.equal(settings.sessionDir, join(dir, "sessions"));
    assert.equal(settings.shellPath, join(dir, "guard.sh"));
    assert.equal(existsSync(join(dir, "skills", "factory-tools", "SKILL.md")), true);

    const guard = readFileSync(join(dir, "guard.sh"), "utf8");
    for (const denied of ["*gradlew*", "gh *", "*git stash*", "*git reset --hard*", "*pkill *"]) {
      assert.equal(guard.includes(denied), true, `guard must deny ${denied}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi model availability reads the two-column model list", () => {
  const list = "provider     model\nvllm         Qwen3.8\nopencode-go  hy4-flash-free\n";
  assert.equal(piModelAvailable(list, "vllm/Qwen3.8"), true);
  assert.equal(piModelAvailable(list, "opencode-go/hy4-flash-free"), true);
  assert.equal(piModelAvailable(list, "opencode-go/missing"), false);
  assert.equal(piModelAvailable("", "vllm/Qwen3.8"), false);
});
