import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrCheck } from "./dependabot-policy.mjs";
import type { ListedFactoryPr } from "./factory-prs.mjs";
import type { FactoryStatus } from "./status.mjs";
import {
  describeFactoryView,
  factoryViewExitCode,
  staleStatusError,
  type FactoryViewInput,
  type ResumableBranch,
} from "./status-view.mjs";

const now = new Date("2026-11-03T14:00:00.000Z");

const status = (overrides: Partial<FactoryStatus> = {}): FactoryStatus => ({
  passId: "pass-1",
  phase: "authoring",
  ticket: null,
  detail: "",
  startedAt: "2026-11-03T13:00:00.000Z",
  updatedAt: "2026-11-03T13:48:00.000Z",
  finishedAt: null,
  error: null,
  tickets: {
    "1933": {
      phase: "authoring",
      detail: "ticket A",
      updatedAt: "2026-11-03T13:55:00.000Z",
    },
  },
  delivered: 0,
  queue: {
    ready: 12,
    eligible: 0,
    heldBack: {
      "branch sandcastle/issue-N exists": 2,
      "claimed by PR #N": 1,
    },
    heldBackNumbers: {
      "branch sandcastle/issue-N exists": [2060, 2058],
      "claimed by PR #N": [1930],
    },
  },
  ...overrides,
});

const branch = (overrides: Partial<ResumableBranch> = {}): ResumableBranch => ({
  issue: 2060,
  branch: "sandcastle/issue-2060",
  head: "bbbbbbb",
  resumeExhausted: false,
  ...overrides,
});

const check = (overrides: Partial<PrCheck> = {}): PrCheck => ({
  __typename: "CheckRun",
  name: "Lint & Code Quality",
  context: "CI/Lint & Code Quality",
  workflowName: "CI",
  status: "COMPLETED",
  conclusion: "SUCCESS",
  detailsUrl: null,
  targetUrl: null,
  ...overrides,
});

const pr = (overrides: Partial<ListedFactoryPr> = {}): ListedFactoryPr => ({
  number: 2481,
  title: "One command for the fleet",
  headRefName: "sandcastle/issue-2481",
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  isCrossRepository: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  statusCheckRollup: [
    check({ name: "Lint & Code Quality" }),
    check({ name: "android-build" }),
    check({ name: "iOS Quick Build Check", workflowName: "iOS PR Checks" }),
  ],
  labels: [],
  ...overrides,
});

const view = (overrides: Partial<FactoryViewInput> = {}): FactoryViewInput => ({
  status: status(),
  resumable: [branch()],
  pullRequests: [pr()],
  ...overrides,
});

test("one view reports the pass, in-flight tickets, retained branches, hold reasons and PR checks", () => {
  // Given: a pass authoring one ticket, two branch-held tickets, one of which
  // already used its resume, and two open delivery pull requests.
  const input = view({
    resumable: [
      // This ticket is actively worked, so it must not read as merely held by a branch.
      branch({ issue: 1933, branch: "sandcastle/issue-1933", head: "aaaaaaa" }),
      branch(),
      branch({ issue: 2058, branch: "sandcastle/issue-2058", head: "ccccccc", resumeExhausted: true }),
    ],
    pullRequests: [
      pr(),
      pr({
        number: 2480,
        title: "Fix a flake",
        headRefName: "sandcastle/issue-2480",
        statusCheckRollup: [check({ conclusion: "FAILURE" })],
      }),
    ],
  });
  // When: the wide view is described.
  const text = describeFactoryView(input, now);
  // Then: every section is present in one report, with ages, numbers and check states.
  assert.equal(
    text,
    [
      "factory status:",
      "  pass:",
      "    running pass, 1 ticket(s) in flight, updated 12m ago",
      "      #1933 authoring — ticket A, updated 5m ago",
      "      queue: 12 ready, 0 eligible",
      "        2 held back: branch sandcastle/issue-N exists (#2060, #2058)",
      "        1 held back: claimed by PR #N (#1930)",
      "  resumable branches:",
      "    #2060 sandcastle/issue-2060 bbbbbbb — retained, not in flight",
      "    #2058 sandcastle/issue-2058 ccccccc — resume already used, needs a human",
      "  delivery pull requests:",
      "    #2481 One command for the fleet: green",
      "    #2480 Fix a flake: 1 failed (Lint & Code Quality)",
    ].join("\n"),
  );
});

test("an actively worked ticket is not listed as one merely held by a stale branch", () => {
  // Given: the only retained branch belongs to a ticket already in flight.
  const text = describeFactoryView(
    view({ resumable: [branch({ issue: 1933, branch: "sandcastle/issue-1933" })] }),
    now,
  );
  // Then: it is reported as in flight under the pass and not under the branches.
  const sections = text.split("  resumable branches:");
  assert.match(sections[0] ?? "", /#1933 authoring/);
  assert.match(sections[1] ?? "", /\(none\)/);
  assert.doesNotMatch(sections[1] ?? "", /#1933 sandcastle\/issue-1933/);
});

test("a single-ticket pass also counts its ticket as in flight", () => {
  // Given: an older, single-ticket status with its ticket in `ticket` only.
  const single = status({ ticket: 2060, tickets: {} });
  const text = describeFactoryView(view({ status: single }), now);
  // Then: its retained branch is active work, not a stale branch to resume.
  assert.match(text, /running authoring #2060/);
  assert.ok(text.includes("  resumable branches:\n    (none)"));
});

test("the wide view reports a held issue's native blockers and their states", () => {
  // Given: a pass whose host snapshot found two native blockers, one still open.
  const input = view({
    status: status({
      blockers: {
        "2665": [
          { number: 2100, title: "Ship the snapshot type", state: "open" },
          { number: 2101, title: "Wire the planner context", state: "closed" },
        ],
      },
    }),
  });
  // When: the operator reads the wide status view.
  const text = describeFactoryView(input, now);
  // Then: the blockers appear in the pass section with their live states.
  assert.match(
    text,
    /#2665 blocked by #2100 "Ship the snapshot type" \(open\), #2101 "Wire the planner context" \(closed\)/,
  );
});

test("an unreadable section is named without hiding the others", () => {
  // Given: only the pass could be read.
  const text = describeFactoryView(
    view({ status: status(), resumable: null, pullRequests: null }),
    now,
  );
  // Then: the rest of the report still renders, with each missing section labeled.
  assert.match(text, /running pass, 1 ticket\(s\) in flight/);
  assert.ok(text.includes("  resumable branches:\n    (unreadable)"));
  assert.ok(text.includes("  delivery pull requests:\n    (unreadable)"));
});

test("a stale pass reports an error and a failing exit code", () => {
  // Given: a pass that stopped updating an hour ago.
  const stale = status({ updatedAt: "2026-11-03T13:00:00.000Z" });
  // When: its health is checked against a 30-minute idle budget.
  const error = staleStatusError(stale, now, 30);
  // Then: the same error a health probe sees is reported and the exit code fails.
  assert.equal(
    error,
    "The pass has not updated for over 30 minutes; check systemctl --user status sandcastle-factory.service",
  );
  assert.equal(factoryViewExitCode(stale, now, 30), 1);
});

test("a fresh pass is healthy and exits zero", () => {
  // Given: a pass updated five minutes ago.
  const fresh = status({ updatedAt: "2026-11-03T13:55:00.000Z" });
  assert.equal(staleStatusError(fresh, now, 30), null);
  assert.equal(factoryViewExitCode(fresh, now, 30), 0);
});

test("a finished pass that failed exits zero on staleness but one overall", () => {
  // Given: a pass that finished with an error long ago.
  const failed = status({
    phase: "failed",
    finishedAt: "2026-11-03T13:00:00.000Z",
    updatedAt: "2026-11-03T13:00:00.000Z",
    error: "the planner returned no decision",
  });
  // Then: it is not stale (it finished), but its error still fails the probe.
  assert.equal(staleStatusError(failed, now, 30), null);
  assert.equal(factoryViewExitCode(failed, now, 30), 1);
});

test("a pass with no status or an unreadable one does not fail the probe", () => {
  for (const missing of [null, "unreadable"] as const) {
    assert.equal(staleStatusError(missing, now, 30), null);
    assert.equal(factoryViewExitCode(missing, now, 30), 0);
  }
});
