import assert from "node:assert/strict";
import test from "node:test";
import { resumeBriefText } from "./resume-context.mjs";

const brief = {
  head: "abcdef1234567890",
  base: "0123456789abcdef",
  commits: [] as readonly string[],
  strikes: [] as readonly { kind: string; detail: string }[],
  hasDeliveryNotes: false,
};

test("a resume brief keeps the branch and base identity", () => {
  const text = resumeBriefText(brief);
  assert.match(text, /interrupted run \(abcdef1\)/);
  assert.match(text, /merge base with 0123456/);
  assert.match(text, /do not redo completed work or rewrite history/);
  assert.doesNotMatch(text, /delivery\.md/);
  assert.doesNotMatch(text, /Why earlier attempts failed/);
});

test("a resume brief carries delivery evidence, commits and failure reasons", () => {
  const text = resumeBriefText({
    ...brief,
    hasDeliveryNotes: true,
    commits: ["aaaaaaa implement the durable contract", "bbbbbbb fix a review finding"],
    strikes: [
      { kind: "review-rejected", detail: "the undo assertion contradicts the planner" },
      { kind: "stalled", detail: "no completion within 45 minutes" },
    ],
  });
  assert.match(text, /Read \.sandcastle\/delivery\.md/);
  assert.match(text, /- aaaaaaa implement the durable contract/);
  assert.match(text, /- bbbbbbb fix a review finding/);
  assert.match(text, /Why earlier attempts failed:/);
  assert.match(text, /- review-rejected: the undo assertion contradicts the planner/);
  assert.match(text, /- stalled: no completion within 45 minutes/);
  assert.match(text, /Do not repeat a failed approach/);
});

test("failure reasons only appear when there are any", () => {
  const text = resumeBriefText({ ...brief, hasDeliveryNotes: true });
  assert.match(text, /Read \.sandcastle\/delivery\.md/);
  assert.doesNotMatch(text, /Why earlier attempts failed/);
  assert.doesNotMatch(text, /Do not repeat a failed approach/);
});
