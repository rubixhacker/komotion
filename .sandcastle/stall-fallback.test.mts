import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorModelFor,
  chooseFallback,
  configWithProviders,
  fallbackProvider,
  hostKeyUsable,
  modelFamily,
  parseFallbackModels,
  reviewRoutesFor,
  SANDBOX_KEY_PATH,
} from "./stall-fallback.mjs";

const QWEN = "vllm/Qwen3.8";
const DEEPSEEK = "opencode-go/deepseek-v4.1-flash";
const OLLAMA = "ollama-cloud/deepseek-v4.1-flash:1017";
const strike = (kind: "stalled" | "blocked") => ({ at: "2026-11-14T00:00:00Z", kind, detail: "" });

test("a ticket is written by the primary model until it stalls", () => {
  assert.equal(authorModelFor([], QWEN, DEEPSEEK), QWEN);
  assert.equal(authorModelFor([strike("blocked")], QWEN, DEEPSEEK), QWEN);
  assert.equal(authorModelFor([strike("blocked"), strike("stalled")], QWEN, DEEPSEEK), DEEPSEEK);
});

test("without a configured fallback a stalled ticket stays with the primary model", () => {
  assert.equal(authorModelFor([strike("stalled")], QWEN, null), QWEN);
});

test("only the two cloud providers can be a fallback", () => {
  assert.equal(fallbackProvider(DEEPSEEK), "opencode-go");
  assert.equal(fallbackProvider("ollama-cloud/deepseek-v4.1-flash:1017"), "ollama-cloud");
  assert.equal(fallbackProvider(QWEN), null);
  assert.equal(fallbackProvider("cerebras/some-model"), null);
});

test("a ticket a cloud model wrote is not reviewed by a route serving that model", () => {
  const routes = [DEEPSEEK, OLLAMA, QWEN];
  assert.deepEqual(reviewRoutesFor(QWEN, routes), routes);
  // The primary route is a different family: same-family fallbacks are dropped.
  assert.deepEqual(reviewRoutesFor(DEEPSEEK, [OLLAMA, QWEN]), [QWEN]);
  assert.deepEqual(
    reviewRoutesFor(DEEPSEEK, [
      "opencode/glm-5.3-flash-free",
      "opencode/deepseek-v4.1-flash-free",
      OLLAMA,
      QWEN,
    ]),
    ["opencode/glm-5.3-flash-free", QWEN],
  );
});

test("a model is the same model whichever provider serves it", () => {
  assert.equal(modelFamily(DEEPSEEK), "deepseek-v4.1-flash");
  assert.equal(modelFamily(OLLAMA), "deepseek-v4.1-flash");
  assert.equal(modelFamily("opencode/deepseek-v4.1-flash-free"), "deepseek-v4.1-flash");
  assert.equal(modelFamily(QWEN), "qwen3.8");
});

test("the sandbox config gains the fallback providers and keeps the rest", () => {
  const config = JSON.stringify({
    enabled_providers: ["vllm"],
    model: QWEN,
    provider: { vllm: { name: "Local vLLM" } },
  });
  assert.deepEqual(JSON.parse(configWithProviders(config, ["ollama-cloud"])), {
    enabled_providers: ["vllm", "ollama-cloud"],
    model: QWEN,
    provider: { vllm: { name: "Local vLLM" } },
  });
  assert.deepEqual(JSON.parse(configWithProviders(config, ["opencode-go", "ollama-cloud"])), {
    enabled_providers: ["vllm", "opencode-go", "ollama-cloud"],
    model: QWEN,
    provider: {
      vllm: { name: "Local vLLM" },
      "opencode-go": { options: { apiKey: `{file:${SANDBOX_KEY_PATH}}` } },
    },
  });
});

test("a configured cloud model is registered so an older sandbox catalog lists it", () => {
  const config = JSON.stringify({ enabled_providers: ["vllm"], provider: {} });
  const go = JSON.parse(
    configWithProviders(config, ["opencode-go"], ["opencode-go/hy4-flash-free"]),
  );
  assert.deepEqual(go.provider["opencode-go"], {
    models: { "hy4-flash-free": {} },
    options: { apiKey: `{file:${SANDBOX_KEY_PATH}}` },
  });
  const ollama = JSON.parse(configWithProviders(config, ["ollama-cloud"], [OLLAMA]));
  assert.deepEqual(ollama.provider["ollama-cloud"], {
    models: { "deepseek-v4.1-flash:1017": {} },
  });
});

test("the fallback list keeps its order and drops blanks and repeats", () => {
  assert.deepEqual(parseFallbackModels(""), []);
  assert.deepEqual(parseFallbackModels(` ${DEEPSEEK} , ${OLLAMA},,${DEEPSEEK}`), [DEEPSEEK, OLLAMA]);
});

test("an explicit owner choice of the same model for both roles overrides the filter", () => {
  const HY4 = "opencode-go/hy4-flash-free";
  const routes = [HY4, OLLAMA, QWEN];
  assert.deepEqual(reviewRoutesFor(HY4, routes), routes);
});

test("the first fallback with a credential and a working route is chosen", () => {
  const models = [DEEPSEEK, OLLAMA];
  const both = new Set(["opencode-go", "ollama-cloud"] as const);
  assert.equal(chooseFallback(models, both, new Set()), DEEPSEEK);
  assert.equal(chooseFallback(models, both, new Set([DEEPSEEK])), OLLAMA);
  assert.equal(chooseFallback(models, new Set(["ollama-cloud"] as const), new Set()), OLLAMA);
  assert.equal(chooseFallback(models, both, new Set(models)), null);
  assert.equal(chooseFallback(models, new Set(), new Set()), null);
});

test("a host key file is mounted only when it is private and not empty", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-key-"));
  try {
    const key = join(directory, "opencode-go.key");
    assert.equal(hostKeyUsable(key), false);
    writeFileSync(key, "", { mode: 0o600 });
    assert.equal(hostKeyUsable(key), false);
    writeFileSync(key, "a-key\n");
    chmodSync(key, 0o644);
    assert.equal(hostKeyUsable(key), false);
    chmodSync(key, 0o600);
    assert.equal(hostKeyUsable(key), true);
    assert.equal(hostKeyUsable(directory), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
