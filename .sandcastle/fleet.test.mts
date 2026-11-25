import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrCheck } from "./dependabot-policy.mjs";
import {
  collectFleet,
  describeFleet,
  describeUnits,
  fleetUnits,
  recentAlerts,
  recentStreaks,
  recentStrikes,
  summarizeChecks,
  type FleetHost,
  type FleetReport,
  type TicketStrike,
  type UnitState,
} from "./fleet.mjs";
import type { ListedFactoryPr } from "./factory-prs.mjs";
import type { FactoryStatus } from "./status.mjs";
import type { Streaks } from "./failure-streak.mjs";

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
  number: 2450,
  title: "Implement X",
  headRefName: "sandcastle/issue-2450",
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

const status = (overrides: Partial<FactoryStatus> = {}): FactoryStatus => ({
  passId: "pass-1",
  phase: "authoring",
  ticket: 1933,
  detail: "",
  startedAt: "2026-11-03T13:00:00.000Z",
  updatedAt: "2026-11-03T13:48:00.000Z",
  finishedAt: null,
  error: null,
  tickets: {},
  delivered: 0,
  ...overrides,
});

const report = (overrides: Partial<FleetReport> = {}): FleetReport => ({
  units: [
    { unit: "sandcastle-factory.service", active: "active", enabled: "enabled" },
    { unit: "sandcastle-factory.timer", active: "active", enabled: "enabled" },
  ],
  status: status(),
  pullRequests: [pr()],
  streaks: {},
  alerts: [],
  strikes: [],
  ...overrides,
});

test("fleetUnits keeps every installed unit and drops the alert template", () => {
  // Given: the unit files of a factory host, including the alert template.
  const files = [
    "sandcastle-factory.service",
    "sandcastle-factory.timer",
    "sandcastle-factory.path",
    "sandcastle-factory-alert@.service",
    "README.md",
  ];
  // When: the fleet's units are listed.
  const units = fleetUnits(files);
  // Then: every real unit is in, the template and the README are out, sorted.
  assert.deepEqual(units, [
    "sandcastle-factory.path",
    "sandcastle-factory.service",
    "sandcastle-factory.timer",
  ]);
});

test("describeUnits prints one line per unit with its state and enablement", () => {
  // Given: the states of two units.
  const states: UnitState[] = [
    { unit: "sandcastle-factory.service", active: "active", enabled: "enabled" },
    { unit: "sandcastle-etl.timer", active: "inactive", enabled: "disabled" },
  ];
  // When: they are described.
  const text = describeUnits(states);
  // Then: each unit is on its own line, active state first.
  assert.equal(
    text,
    "    sandcastle-factory.service: active (enabled)\n    sandcastle-etl.timer: inactive (disabled)",
  );
});

test("a green pull request's check summary says green", () => {
  // Given: a factory PR whose required checks are all green.
  const greenPr = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality" }),
      check({ name: "android-build" }),
      check({ name: "iOS Quick Build Check", workflowName: "iOS PR Checks" }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(greenPr);
  // Then: the reader sees the green verdict without opening the PR.
  assert.equal(summary, "green");
});

test("a passing pull request missing a required check is not green", () => {
  // Given: a PR whose checks all pass but the required iOS quick check is absent.
  const notGreen = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality" }),
      check({ name: "android-build" }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(notGreen);
  // Then: the passing checks are counted and the PR is not called green.
  assert.equal(summary, "2 passed");
});

test("a failing pull request's check summary names the failed checks", () => {
  // Given: a PR with one failed check and one still running.
  const failing = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality", conclusion: "FAILURE" }),
      check({ name: "android-build", status: "IN_PROGRESS", conclusion: null }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(failing);
  // Then: the failure is named and the running check is counted.
  assert.equal(summary, "1 failed (Lint & Code Quality), 1 running");
});

test("a conflicting base and cancelled checks are both reported", () => {
  // Given: a PR whose base conflicts and whose checks were cancelled.
  const stuck = pr({
    mergeable: "CONFLICTING",
    statusCheckRollup: [check({ conclusion: "CANCELLED" }), check({ conclusion: "CANCELLED" })],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(stuck);
  // Then: the conflict and the cancelled checks are both on the line.
  assert.equal(summary, "conflict, 2 cancelled");
});

test("a skipped iOS quick check beside a passing classifier is green", () => {
  // Given: a PR whose iOS quick check was skipped, beside a passing classifier.
  const skipped = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality" }),
      check({ name: "android-build" }),
      check({
        name: "iOS Quick Build Check",
        workflowName: "iOS PR Checks",
        conclusion: "SKIPPED",
      }),
      check({ name: "Detect iOS-relevant changes", workflowName: "iOS PR Checks" }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(skipped);
  // Then: the skip is summarized and the PR is green the way the merge gate does.
  assert.equal(summary, "1 skipped, green");
});

test("a skipped check without a passing classifier is not green", () => {
  // Given: a PR whose iOS quick check was skipped, with no passing classifier.
  const skipped = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality" }),
      check({ name: "android-build" }),
      check({
        name: "iOS Quick Build Check",
        workflowName: "iOS PR Checks",
        conclusion: "SKIPPED",
      }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(skipped);
  // Then: the skip is named and the PR is not green.
  assert.equal(summary, "1 skipped, 2 passed");
});

test("a neutral check is summarized, not left out", () => {
  // Given: a PR whose checks completed, one of them neutral.
  const neutral = pr({
    statusCheckRollup: [
      check({ name: "Lint & Code Quality" }),
      check({ name: "android-build" }),
      check({
        name: "iOS Quick Build Check",
        workflowName: "iOS PR Checks",
        conclusion: "NEUTRAL",
      }),
    ],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(neutral);
  // Then: the neutral check is on the line (grouped with the skipped) and the PR is not green.
  assert.equal(summary, "1 skipped, 2 passed");
});

test("a stale check is summarized, not left out", () => {
  // Given: a PR whose only check completed stale, on an older head.
  const stale = pr({
    statusCheckRollup: [check({ name: "Lint & Code Quality", conclusion: "STALE" })],
  });
  // When: its checks are summarized.
  const summary = summarizeChecks(stale);
  // Then: the stale check is on the line (grouped with the skipped), not "no checks yet".
  assert.equal(summary, "1 skipped");
});

test("a pull request with no checks yet says so", () => {
  // Given: a PR whose checks have not started.
  const bare = pr({ statusCheckRollup: [] });
  // When: its checks are summarized.
  const summary = summarizeChecks(bare);
  // Then: the reader is not left guessing.
  assert.equal(summary, "no checks yet");
});

test("the fleet report names every unit, the pass, and the pull requests", () => {
  // Given: a fleet with two units, a running pass, and one open factory PR.
  const text = describeFleet(report(), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: every section is present and the pass's age is computed.
  assert.ok(text.startsWith("sandcastle fleet:"));
  assert.ok(text.includes("    sandcastle-factory.service: active (enabled)"));
  assert.ok(text.includes("    running authoring #1933, updated 12m ago"));
  assert.ok(text.includes("    #2450 Implement X: green"));
});

test("a factory PR list is bounded to ten lines and the rest counted", () => {
  // Given: twelve open factory PRs.
  const many = Array.from({ length: 12 }, (_, index) =>
    pr({
      number: 2450 + index,
      title: `Ticket ${index}`,
      headRefName: `sandcastle/issue-${2450 + index}`,
    }),
  );
  // When: the fleet is described.
  const text = describeFleet(report({ pullRequests: many }), new Date("2026-11-03T14:00:00.000Z"));
  // Then: the first ten PRs are on their own lines and the rest are counted.
  assert.ok(text.includes("    #2450 Ticket 0: green"));
  assert.ok(text.includes("    #2459 Ticket 9: green"));
  assert.ok(!text.includes("    #2460 Ticket 10"));
  assert.ok(text.includes("    2 more open factory PRs"));
});

test("non-factory pull requests are counted, not listed", () => {
  // Given: one factory PR and three that are not the factory's.
  const mixed = [
    pr(),
    pr({ number: 100, title: "Human PR", headRefName: "feature/thing" }),
    pr({ number: 101, title: "Another", headRefName: "feature/other" }),
    pr({ number: 102, title: "Draft", headRefName: "sandcastle/issue-102", isDraft: true }),
  ];
  // When: the fleet is described.
  const text = describeFleet(report({ pullRequests: mixed }), new Date("2026-11-03T14:00:00.000Z"));
  // Then: the factory PR is listed and the others are counted, the draft included.
  assert.ok(text.includes("    #2450 Implement X: green"));
  assert.ok(text.includes("    3 open non-factory PRs"));
  assert.ok(!text.includes("Human PR"));
});

test("unreadable sections are reported as unreadable", () => {
  // Given: a fleet whose units and pull requests could not be read.
  const text = describeFleet(
    report({ units: null, pullRequests: null }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // When: it is read.
  // Then: the unreadable sections say so and the rest is still there.
  assert.ok(text.includes("  units:\n    (unreadable)"));
  assert.ok(text.includes("  pull requests:\n    (unreadable)"));
  assert.ok(text.includes("    running authoring #1933, updated 12m ago"));
});

test("an unreadable status file is reported as unreadable, not absent", () => {
  // Given: a fleet whose status file was present but could not be read.
  const text = describeFleet(report({ status: "unreadable" }), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: the section says unreadable, not "no pass has recorded a status".
  assert.ok(text.includes("  factory pass:\n    (unreadable)"));
  assert.ok(!text.includes("(no pass has recorded a status)"));
});

test("an absent status file is reported as no pass, not unreadable", () => {
  // Given: a fleet whose status file does not exist.
  const text = describeFleet(report({ status: null }), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: the section says no pass, not unreadable.
  assert.ok(text.includes("  factory pass:\n    (no pass has recorded a status)"));
  assert.ok(!text.includes("  factory pass:\n    (unreadable)"));
});

test("an unreadable streaks file is marked, the rest still listed", () => {
  // Given: a fleet whose streaks file was present but unreadable, with alerts and strikes.
  const alerts = ["2026-11-03T12:05:00+00:00 factory sandcastle-factory.service failed"];
  const strikes: TicketStrike[] = [
    {
      issue: 1933,
      strike: { at: "2026-11-03T11:00:00.000Z", kind: "gate-failed", detail: "qualityGate" },
    },
  ];
  const text = describeFleet(
    report({ streaks: null, alerts, strikes }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // When: it is read.
  // Then: the streaks file is marked unreadable and the rest is still listed.
  assert.ok(text.includes("(failure-streaks.json unreadable)"));
  assert.ok(text.includes("    2026-11-03T12:05:00+00:00 factory sandcastle-factory.service failed"));
  assert.ok(text.includes("    #1933: 2026-11-03T11:00:00.000Z gate-failed — qualityGate"));
});

test("an unreadable alerts file is marked", () => {
  // Given: a fleet whose alert log was present but unreadable.
  const text = describeFleet(report({ alerts: null }), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: the section marks the file and does not read it as none.
  assert.ok(text.includes("(factory-alerts.log unreadable)"));
  assert.ok(!text.includes("(none recorded)"));
});

test("an unreadable ledger is marked", () => {
  // Given: a fleet whose ticket ledger was present but unreadable.
  const text = describeFleet(report({ strikes: null }), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: the section marks the file and does not read it as none.
  assert.ok(text.includes("(ticket-ledger.json unreadable)"));
  assert.ok(!text.includes("(none recorded)"));
});

test("a recent failures section that is wholly unreadable names every file", () => {
  // Given: a fleet whose streaks, alerts, and strikes files were all present but unreadable.
  const text = describeFleet(
    report({ streaks: null, alerts: null, strikes: null }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // When: it is read.
  // Then: the section names every unreadable file, not "none recorded".
  assert.ok(
    text.includes(
      "  recent failures:\n    (failure-streaks.json, factory-alerts.log, ticket-ledger.json unreadable)",
    ),
  );
  assert.ok(!text.includes("(none recorded)"));
});

test("the recent failures section lists streaks, alerts and strikes", () => {
  // Given: a fleet with one failure streak, one alert entry and two strikes.
  const streaks: Streaks = {
    pass: {
      fingerprint: "pass|The preflight failed",
      message: "The preflight failed",
      count: 3,
      firstAt: "2026-11-03T10:00:00.000Z",
      lastAt: "2026-11-03T12:00:00.000Z",
    },
  };
  const strikes: TicketStrike[] = [
    {
      issue: 1933,
      strike: { at: "2026-11-03T11:00:00.000Z", kind: "gate-failed", detail: "qualityGate" },
    },
    {
      issue: 1934,
      strike: { at: "2026-11-03T10:30:00.000Z", kind: "stalled", detail: "" },
    },
  ];
  const text = describeFleet(
    report({
      streaks,
      alerts: ["2026-11-03T12:05:00+00:00 factory sandcastle-factory.service failed"],
      strikes,
    }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // When: it is read.
  // Then: the streak, the alert and both strikes are on the report.
  assert.ok(text.includes("pass failed 3 time(s) in a row since 2026-11-03T10:00:00.000Z"));
  assert.ok(text.includes("    2026-11-03T12:05:00+00:00 factory sandcastle-factory.service failed"));
  assert.ok(text.includes("    #1933: 2026-11-03T11:00:00.000Z gate-failed — qualityGate"));
  assert.ok(text.includes("    #1934: 2026-11-03T10:30:00.000Z stalled"));
});

test("a fleet with no recent failures says none recorded", () => {
  // Given: a fleet with no streaks, alerts or strikes.
  const text = describeFleet(report(), new Date("2026-11-03T14:00:00.000Z"));
  // When: it is read.
  // Then: the section is not left empty.
  assert.ok(text.includes("  recent failures:\n    (none recorded)"));
});

test("recentAlerts distinguishes absent from unreadable", () => {
  // Given: a scratch directory, with and without an alert log.
  const dir = mkdtempSync(join(tmpdir(), "fleet-alerts-"));
  try {
    // Absent log: none, not unreadable.
    assert.deepEqual(recentAlerts(join(dir, "missing.log"), 5), []);
    // Present but unreadable (a directory, which readFileSync cannot read): null.
    assert.equal(recentAlerts(dir, 5), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recentStreaks distinguishes absent from unreadable", () => {
  // Given: a scratch directory, with and without a streaks file.
  const dir = mkdtempSync(join(tmpdir(), "fleet-streaks-"));
  try {
    // Absent file: an empty record, not unreadable.
    assert.deepEqual(recentStreaks(join(dir, "missing.json"), 5), {});
    // Present but corrupt: unreadable.
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{ not json");
    assert.equal(recentStreaks(corrupt, 5), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recentStrikes distinguishes absent from unreadable", () => {
  // Given: a scratch directory, with and without a ledger.
  const dir = mkdtempSync(join(tmpdir(), "fleet-strikes-"));
  try {
    // Absent ledger: none, not unreadable.
    assert.deepEqual(recentStrikes(join(dir, "missing.json"), 5), []);
    // Present but corrupt: unreadable.
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{ not json");
    assert.equal(recentStrikes(corrupt, 5), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectFleet distinguishes an absent from an unreadable status file", () => {
  // Given: a scratch runtime root with the fleet's directories, no status file.
  const root = mkdtempSync(join(tmpdir(), "fleet-root-"));
  try {
    mkdirSync(join(root, ".sandcastle", "logs"), { recursive: true });
    const host: FleetHost = {
      root,
      command: () => "[]",
      unitQuery: () => "unknown",
    };
    // When: no pass has written a status file.
    // Then: the status is absent, not unreadable.
    assert.equal(collectFleet(host).status, null);
    // When: the status file is present but corrupt.
    writeFileSync(join(root, ".sandcastle", "logs", "status.json"), "{ not json");
    // Then: the status is unreadable, not absent.
    assert.equal(collectFleet(host).status, "unreadable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
