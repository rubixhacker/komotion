import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryBody } from "./delivery-body.mjs";

const body = deliveryBody({
  issue: 42,
  base: "b".repeat(40),
  head: "h".repeat(40),
  pendingBanner: "",
  lintNote: null,
  swiftNote: null,
  authorModel: "vllm/Qwen3.8",
  reviewerModel: "opencode-go/deepseek-v4.1-flash",
  deliveryNotes: "## Delivery\n\nEvidence.",
});

test("the first line closes the issue on GitHub when the PR merges", () => {
  assert.match(body, /^Closes #42\.\n/u);
});

test("the body carries the base, head, models and delivery notes", () => {
  assert.match(body, /Base: b{40}\nHead: h{40}/u);
  assert.match(body, /Author model: vllm\/Qwen3\.8; reviewer model: opencode-go\/deepseek-v4\.1-flash\./u);
  assert.ok(body.endsWith("## Delivery\n\nEvidence.\n"));
});

test("check notes appear only when they exist", () => {
  assert.ok(!body.includes("Swift lint:"));
  assert.ok(!body.includes("Swift compile:"));
  const noted = deliveryBody({
    issue: 42,
    base: "b".repeat(40),
    head: "h".repeat(40),
    pendingBanner: "Device/store evidence pending: later.\n\n",
    lintNote: "passed",
    swiftNote: "not checked",
    authorModel: "vllm/Qwen3.8",
    reviewerModel: "opencode-go/deepseek-v4.1-flash",
    deliveryNotes: "Notes.",
  });
  assert.match(noted, /Swift lint: passed\./u);
  assert.match(noted, /Swift compile: not checked\./u);
  assert.match(noted, /^Closes #42\.\n\nDevice\/store evidence pending: later\./u);
});
