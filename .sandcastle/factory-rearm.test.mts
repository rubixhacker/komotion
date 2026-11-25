import { test } from "node:test";
import assert from "node:assert/strict";
import { planFactoryRearm } from "./factory-rearm.mjs";

const HEAD = "c3bb912591b42a9f39ad3d56d406f930c4431ee8";
const entries = [{ prNumber: 2716, head: HEAD }];

test("an escalated PR is re-armed when the factory code moves", () => {
  const plan = planFactoryRearm({
    entries,
    alerted: new Set([`pr:2716:${HEAD}:conflict`]),
    repaired: new Set([`${HEAD}:conflict`, `pr:2716:repair:${HEAD}`]),
    rearmed: new Map(),
    codeIdentity: "new-code",
  });
  assert.deepEqual(plan.alertKeys, [`pr:2716:${HEAD}:conflict`]);
  assert.deepEqual(plan.attemptMarks, [`${HEAD}:conflict`, `pr:2716:repair:${HEAD}`]);
  assert.deepEqual(plan.prNumbers, [2716]);
});

test("a re-arm happens only once per factory code identity", () => {
  const input = {
    entries,
    alerted: new Set([`pr:2716:${HEAD}:conflict`]),
    repaired: new Set([`${HEAD}:conflict`]),
    rearmed: new Map([[2716, "new-code"]]),
    codeIdentity: "new-code",
  };
  assert.deepEqual(planFactoryRearm(input).prNumbers, []);
  // A later factory change arms the same PR once more.
  assert.deepEqual(planFactoryRearm({ ...input, codeIdentity: "later-code" }).prNumbers, [2716]);
});

test("a PR that is not escalated is left alone", () => {
  const plan = planFactoryRearm({
    entries,
    alerted: new Set(),
    repaired: new Set([`${HEAD}:conflict`]),
    rearmed: new Map(),
    codeIdentity: "new-code",
  });
  assert.deepEqual(plan, { alertKeys: [], attemptMarks: [], prNumbers: [] });
});

test("a check-repair escalation is re-armed too", () => {
  const plan = planFactoryRearm({
    entries,
    alerted: new Set([`pr:2716:${HEAD}`]),
    repaired: new Set([HEAD, `pr:2716:repair:${HEAD}`]),
    rearmed: new Map(),
    codeIdentity: "new-code",
  });
  assert.deepEqual(plan.alertKeys, [`pr:2716:${HEAD}`]);
  assert.deepEqual(plan.attemptMarks, [`pr:2716:repair:${HEAD}`, HEAD]);
});

test("only marks that exist are removed", () => {
  const plan = planFactoryRearm({
    entries,
    alerted: new Set([`pr:2716:${HEAD}:conflict`]),
    repaired: new Set(),
    rearmed: new Map(),
    codeIdentity: "new-code",
  });
  assert.deepEqual(plan.alertKeys, [`pr:2716:${HEAD}:conflict`]);
  assert.deepEqual(plan.attemptMarks, []);
});

test("several PRs are re-armed independently", () => {
  const other = "f4bdc15f16ff2fef4480db5fb610e456d57e1760";
  const plan = planFactoryRearm({
    entries: [
      { prNumber: 2716, head: HEAD },
      { prNumber: 2715, head: other },
    ],
    alerted: new Set([`pr:2716:${HEAD}:conflict`, `pr:2715:${other}:conflict`]),
    repaired: new Set([`${HEAD}:conflict`, `${other}:conflict`]),
    rearmed: new Map([[2715, "new-code"]]),
    codeIdentity: "new-code",
  });
  assert.deepEqual(plan.prNumbers, [2716]);
  assert.deepEqual(plan.alertKeys, [`pr:2716:${HEAD}:conflict`]);
});
