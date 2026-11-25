import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  EXPECTED_CHECKS,
  canMerge,
  humanApproved,
  passDeadline,
  MAX_REPAIR_ATTEMPTS_PER_PR,
  repairAttempts,
  repairBudget,
  staleAttemptBranches,
  repairDrift,
  touchesSensitivePath,
} from "./dependabot-policy.mjs";
import type { BotPr } from "./dependabot-policy.mjs";
const passing = (): BotPr => ({
  number: 42,
  title: "Dependency update",
  url: "https://github.com/rubixhacker/komotion/pull/42",
  author: { login: "app/dependabot", is_bot: true },
  headRefName: "dependabot/gradle/library",
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  isCrossRepository: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  statusCheckRollup: EXPECTED_CHECKS.map(([workflowName, name]) => ({
    __typename: "CheckRun",
    workflowName,
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  })),
});
test("all applicable green checks permit an up-to-date Dependabot merge", () => {
  // Given: the current bot head passed every applicable gate.
  const pr = passing();
  // When / Then: it is eligible for merging.
  assert.equal(decide(pr, true), "merge");
});
test("green stale heads must rebase and rerun CI before merging", () => {
  // Given: a green head that lacks latest main.
  const pr = passing();
  // When / Then: it is rebased instead of merged.
  assert.equal(decide(pr, false), "rebase");
});
test("missing or skipped native gates never count as green", () => {
  // Given: a PR missing its native check.
  const pr = passing();
  pr.statusCheckRollup =
    pr.statusCheckRollup?.filter(
      (check) => check.name !== "iOS Quick Build Check",
    ) ?? [];
  // When / Then: it remains pending.
  assert.equal(decide(pr, true), "wait");
});
test("human authored PRs are never mutated", () => {
  // Given: a green human PR with a Dependabot-looking branch.
  const pr = passing();
  pr.author = { login: "human", is_bot: false };
  // When / Then: it is ignored.
  assert.equal(decide(pr, true), "ignore");
});
test("failed checks require repair", () => {
  // Given: a failing head already based on main.
  const pr = passing();
  pr.statusCheckRollup?.push({
    __typename: "CheckRun",
    workflowName: "Extra",
    name: "test",
    status: "COMPLETED",
    conclusion: "FAILURE",
  });
  // When / Then: it is sent for repair.
  assert.equal(decide(pr, true), "repair");
});
test("a classifier-backed iOS skip permits an otherwise green PR", () => {
  // Given: the classifier found no iOS-relevant change and the quick check skipped.
  const pr = passing();
  const native = pr.statusCheckRollup?.find(
    (check) => check.name === "iOS Quick Build Check",
  );
  if (!native) throw new Error("Native fixture missing");
  native.conclusion = "SKIPPED";
  pr.statusCheckRollup?.push({
    __typename: "CheckRun",
    workflowName: "iOS PR Checks",
    name: "Detect iOS-relevant changes",
    status: "COMPLETED",
    conclusion: "SUCCESS",
  });
  // When / Then: the skip counts as passing.
  assert.equal(decide(pr, true), "merge");
});
test("pending and cancelled checks cannot permit a merge", () => {
  // Given: a green core with an unfinished additional gate.
  const pr = passing();
  pr.statusCheckRollup?.push({
    __typename: "CheckRun",
    workflowName: "Extra",
    name: "test",
    status: "IN_PROGRESS",
    conclusion: null,
  });
  // When / Then: no merge is allowed.
  assert.equal(decide(pr, true), "wait");
});

test("the main-only Pages deployment skip does not block a green PR", () => {
  const pr = passing();
  pr.statusCheckRollup?.push(
    {
      __typename: "CheckRun",
      workflowName: "Site",
      name: "build",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    },
    {
      __typename: "CheckRun",
      workflowName: "Site",
      name: "deploy",
      status: "COMPLETED",
      conclusion: "SKIPPED",
    },
  );
  assert.equal(decide(pr, true), "merge");
  const build = pr.statusCheckRollup?.find(
    (check) => check.workflowName === "Site" && check.name === "build",
  );
  if (!build) throw new Error("Missing site build fixture");
  build.conclusion = "FAILURE";
  assert.equal(decide(pr, true), "repair");
});

test("a bot approval is not a human approval", () => {
  assert.equal(
    humanApproved([
      { state: "APPROVED", author: { login: "app/dependabot", is_bot: true } },
    ]),
    false,
  );
  assert.equal(
    humanApproved([
      { state: "APPROVED", author: { login: "rubixhacker", is_bot: false } },
    ]),
    true,
  );
  assert.equal(
    humanApproved([{ state: "COMMENTED", author: { login: "rubixhacker" } }]),
    false,
  );
  assert.equal(
    humanApproved([{ state: "APPROVED", author: null }]),
    false,
  );
});

test("a repair may not drop the update or add a workflow", () => {
  assert.equal(repairDrift(["gradle/libs.versions.toml"], ["gradle/libs.versions.toml", "src/App.kt"]), null);
  assert.match(
    repairDrift(["gradle/libs.versions.toml"], ["src/App.kt"]) ?? "",
    /no longer changes/,
  );
  assert.match(
    repairDrift(["gradle/libs.versions.toml"], ["gradle/libs.versions.toml", ".github/workflows/ci.yml"]) ?? "",
    /repair added/,
  );
});

test("factory plumbing, workflows, and credentials are sensitive; app source is not", () => {
  // Given: a change that only touches application code and build inputs.
  const benign = ["src/App.kt", "gradle/libs.versions.toml", "shared/core/telemetry/Log.kt"];
  // When / Then: it is never sensitive.
  assert.equal(touchesSensitivePath(benign), false);
  // And: an empty change is not sensitive.
  assert.equal(touchesSensitivePath([]), false);
});

test("any factory, workflow, CI-script, or credential path is sensitive", () => {
  // Given: one change to each sensitive path family.
  const sensitive = [
    ".sandcastle/main.mts",
    ".github/workflows/ci.yml",
    "scripts/ci/lint.sh",
    "iosApp/google-services.json",
    ".sandcastle/.env",
  ];
  // When / Then: each one on its own is sensitive.
  for (const file of sensitive) {
    assert.equal(touchesSensitivePath([file]), true, `expected ${file} to be sensitive`);
  }
  // And: a sensitive path among benign ones is still sensitive.
  assert.equal(touchesSensitivePath(["src/App.kt", ".sandcastle/README.md"]), true);
});

test("a changed head or base invalidates previously green merge evidence", () => {
  // Given: a green PR whose previously observed head/base is stale.
  const pr = passing();
  // When / Then: the final merge guard refuses either race.
  assert.equal(canMerge(pr, "b".repeat(40), "base", "base"), false);
  assert.equal(canMerge(pr, pr.headRefOid, "old-base", "new-base"), false);
});
test("a skipped native check without a classifier run blocks merging", () => {
  // Given: a native gate reports skipped and no classifier run succeeded.
  const pr = passing();
  const native = pr.statusCheckRollup?.find(
    (check) => check.name === "iOS Quick Build Check",
  );
  if (!native) throw new Error("Native fixture missing");
  native.conclusion = "SKIPPED";
  // When / Then: it remains unpassed.
  assert.equal(decide(pr, true), "wait");
});
test("cancelled extra checks block merging", () => {
  // Given: an otherwise green PR with a cancelled gate.
  const pr = passing();
  pr.statusCheckRollup?.push({
    __typename: "CheckRun",
    workflowName: "Extra",
    name: "test",
    status: "COMPLETED",
    conclusion: "CANCELLED",
  });
  // When / Then: the cancellation is not green.
  assert.equal(decide(pr, true), "wait");
});

test("a recurring failure on a new head keeps the repair budget of its base", () => {
  // Given: two repair pushes already spent on this main base.
  const prior = { base: "base", attempts: 2 };
  // When / Then: the new head inherits the spent budget instead of a fresh one.
  assert.equal(repairAttempts(prior, "base"), 2);
  // And a moved base restores the budget.
  assert.equal(repairAttempts(prior, "next-base"), 0);
  assert.equal(repairAttempts(undefined, "base"), 0);
});

test("a steady event stream cannot extend one pass past its cap", () => {
  const startedAt = 1_000_000;
  // Given: an event arriving well inside the cap.
  assert.equal(
    passDeadline(startedAt, startedAt + 20 * 60_000, 45, 180),
    startedAt + 65 * 60_000,
  );
  // When / Then: the pass still ends at the cap, not 45 minutes after the last event.
  assert.equal(
    passDeadline(startedAt, startedAt + 175 * 60_000, 45, 180),
    startedAt + 180 * 60_000,
  );
});

test("a pull request that keeps failing runs out of repairs however often main moves", () => {
  // Given: the watchdog's own bookkeeping, replayed for one pull request while
  // main moves after every third attempt, as it did for the update that got
  // nine repair runs over three bases.
  let entry: { base: string; attempts: number; total?: number } | undefined;
  let runs = 0;
  for (let base = 0; base < 40; base += 1) {
    for (let sweep = 0; sweep < 5; sweep += 1) {
      const budget = repairBudget(entry, `base-${base}`);
      if (budget.exhausted !== null) continue;
      runs += 1;
      entry = { base: `base-${base}`, attempts: budget.onBase + 1, total: budget.total + 1 };
    }
  }
  // Then: the lifetime budget ends it, and a new base does not reopen it.
  assert.equal(runs, MAX_REPAIR_ATTEMPTS_PER_PR);
  assert.equal(repairBudget(entry, "base-41").exhausted, "pull-request");
});

test("a spent base still waits for the next one while the lifetime budget lasts", () => {
  const prior = { base: "base", attempts: 3, total: 3 };
  assert.equal(repairBudget(prior, "base").exhausted, "base");
  assert.deepEqual(repairBudget(prior, "next-base"), { onBase: 0, total: 3, exhausted: null });
  assert.deepEqual(repairBudget(undefined, "base"), { onBase: 0, total: 0, exhausted: null });
});

test("a ledger entry written before the lifetime count still counts its attempts", () => {
  assert.equal(repairBudget({ base: "base", attempts: 2 }, "next-base").total, 2);
});

test("repair branches go when their pull request is no longer open", () => {
  // Given: the branches the watchdog had left behind by 12 November.
  const branches = [
    "sandcastle/dependabot-1639-282ecbbc-1792593537563",
    "sandcastle/dependabot-1909-69f0f35d-1793693169122",
    "sandcastle/dependabot-2041-26f22628-1794262289272",
    "sandcastle/dependabot-2041-57e7aebe-1794267242594",
    "sandcastle/issue-2060",
    "sandcastle/runtime",
  ];
  // When: only #2041 is still open, and one of its branches is checked out.
  const stale = staleAttemptBranches(
    branches,
    new Set([2041]),
    new Set(["sandcastle/dependabot-2041-57e7aebe-1794267242594"]),
  );
  // Then: the closed pull requests' branches go; ticket and runtime branches are never touched.
  assert.deepEqual(stale, [
    "sandcastle/dependabot-1639-282ecbbc-1792593537563",
    "sandcastle/dependabot-1909-69f0f35d-1793693169122",
  ]);
  // And: a branch of a closed pull request stays while a worktree has it checked out.
  assert.deepEqual(
    staleAttemptBranches(branches.slice(0, 1), new Set(), new Set(branches.slice(0, 1))),
    [],
  );
});
