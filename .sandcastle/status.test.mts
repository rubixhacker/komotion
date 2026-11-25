import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRunBanner,
  describeStatus,
  heldByBranch,
  readStatus,
  statusIsStale,
  summarizeQueue,
  writeStatus,
  type FactoryStatus,
} from "./status.mjs";

const status = (overrides: Partial<FactoryStatus> = {}): FactoryStatus => ({
  passId: "pass-1",
  phase: "authoring",
  ticket: 1933,
  detail: "",
  startedAt: "2026-11-03T13:00:00.000Z",
  updatedAt: "2026-11-03T13:30:00.000Z",
  finishedAt: null,
  error: null,
  tickets: {},
  delivered: 0,
  ...overrides,
});

test("a running pass goes stale once it stops updating", () => {
  // Given: a pass whose last update was 40 minutes ago.
  const running = status();
  // When: the pass is checked against a 30-minute idle budget.
  const stale = statusIsStale(running, new Date("2026-11-03T14:10:00.000Z"), 30 * 60_000);
  const fresh = statusIsStale(running, new Date("2026-11-03T13:40:00.000Z"), 30 * 60_000);
  // Then: only the pass beyond the budget reports stale.
  assert.equal(stale, true);
  assert.equal(fresh, false);
});

test("a finished pass is never stale however old it is", () => {
  // Given: a pass that finished an hour ago.
  const finished = status({
    phase: "finished",
    finishedAt: "2026-11-03T13:35:00.000Z",
  });
  // When: it is checked well past the idle budget.
  const stale = statusIsStale(finished, new Date("2026-11-03T20:00:00.000Z"), 60_000);
  // Then: a finished pass reports its outcome rather than looking hung.
  assert.equal(stale, false);
});

test("an unparsable update time counts as stale", () => {
  // Given: a status whose update time cannot be read.
  const broken = status({ updatedAt: "not-a-date" });
  // When: staleness is checked.
  // Then: the pass is treated as stale rather than silently healthy.
  assert.equal(statusIsStale(broken, new Date("2026-11-03T13:31:00.000Z"), 60_000), true);
});

test("the status file round-trips through disk", () => {
  // Given: a directory that does not exist yet.
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-status-"));
  const path = join(dir, "nested", "status.json");
  try {
    // When: a status is written and read back.
    writeStatus(path, status({ detail: "author on #1933" }));
    const read = readStatus(path);
    // Then: every field survives, including the nested directory creation.
    assert.deepEqual(read, status({ detail: "author on #1933" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing status file reads as null rather than throwing", () => {
  // Given: a path with no status file.
  // When: it is read.
  // Then: the caller gets null and can say "unknown" itself.
  assert.equal(readStatus(join(tmpdir(), "sandcastle-status-absent.json")), null);
});

test("the one-line summary names the phase, ticket and age", () => {
  // Given: a running pass on a ticket, updated 12 minutes ago.
  const running = status({ updatedAt: "2026-11-03T13:48:00.000Z" });
  // When: it is described.
  const summary = describeStatus(running, new Date("2026-11-03T14:00:00.000Z"));
  // Then: the reader sees what it is doing without opening the JSON.
  assert.equal(summary, "running authoring #1933, updated 12m ago");
});

test("a parallel pass names every in-flight ticket", () => {
  // Given: a pass working two tickets at once, updated 5 and 12 minutes ago.
  const running = status({
    updatedAt: "2026-11-03T13:48:00.000Z",
    tickets: {
      "1933": { phase: "authoring", detail: "ticket A", updatedAt: "2026-11-03T13:48:00.000Z" },
      "1934": { phase: "gating", detail: "qualityGate", updatedAt: "2026-11-03T13:48:00.000Z" },
    },
  });
  // When: it is described.
  const summary = describeStatus(running, new Date("2026-11-03T14:00:00.000Z"));
  // Then: the reader sees one line per ticket, plus the pass summary.
  assert.equal(
    summary,
    [
      "running pass, 2 ticket(s) in flight, updated 12m ago",
      "  #1933 authoring — ticket A, updated 12m ago",
      "  #1934 gating — qualityGate, updated 12m ago",
    ].join("\n"),
  );
});

test("native blockers of a held issue are reported with their live states", () => {
  // Given: one held issue with two native blockers in mixed states, as read
  // into the status file from the host's issue snapshot.
  const held = status({
    blockers: {
      "2665": [
        { number: 2100, title: "Ship the snapshot type", state: "open" },
        { number: 2101, title: "Wire the planner context", state: "closed" },
      ],
    },
  });
  // When: the status is described.
  const summary = describeStatus(held, new Date("2026-11-03T14:00:00.000Z"));
  // Then: the operator can see why the issue is held without opening GitHub.
  assert.equal(
    summary,
    [
      "running authoring #1933, updated 30m ago",
      '  #2665 blocked by #2100 "Ship the snapshot type" (open), #2101 "Wire the planner context" (closed)',
    ].join("\n"),
  );
});

test("native blockers round-trip through the status file the CLI reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-status-"));
  const path = join(dir, "status.json");
  const held = status({
    blockers: {
      "2665": [{ number: 2100, title: "Ship the snapshot type", state: "open" }],
    },
  });
  try {
    writeStatus(path, held);
    const read = readStatus(path);
    assert.deepEqual(read?.blockers, held.blockers);
    assert.match(
      describeStatus(read!, new Date("2026-11-03T14:00:00.000Z")),
      /blocked by #2100 "Ship the snapshot type" \(open\)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a status file written before blockers existed still reads and describes", () => {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-status-"));
  const path = join(dir, "status.json");
  try {
    writeStatus(path, status());
    const read = readStatus(path);
    assert.equal(read?.blockers, undefined);
    assert.match(describeStatus(read!, new Date("2026-11-03T14:00:00.000Z")), /^running authoring/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deliberately stopped pass reports stopped, not running", () => {
  // Given: a pass that was stopped while authoring a ticket.
  const stopped: FactoryStatus = status({
    phase: "stopped",
    ticket: 1928,
    detail: "stopped by SIGTERM",
    updatedAt: "2026-11-03T19:40:00.000Z",
    finishedAt: "2026-11-03T19:40:00.000Z",
  });
  // When: it is described and checked for staleness.
  const summary = describeStatus(stopped, new Date("2026-11-03T21:00:00.000Z"));
  // Then: it reads as finished, so a stopped service is never mistaken for a hung one.
  assert.equal(summary, "finished stopped #1928, updated 80m ago — stopped by SIGTERM");
  assert.equal(statusIsStale(stopped, new Date("2026-11-03T21:00:00.000Z"), 60_000), false);
});

test("each run appends its own banner so an appended log can be split", () => {
  // Given: a log file two runs write to, as every pass of one branch does.
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-banner-"));
  const path = join(dir, "logs", "sandcastle-issue-1929-author-1929.log");
  try {
    // When: two runs mark their start.
    appendRunBanner(path, "author #1929", new Date("2026-11-03T16:02:00.000Z"));
    appendRunBanner(path, "author #1929", new Date("2026-11-03T18:51:00.000Z"));
    // Then: both markers are present, in order, so the boundary is findable.
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.startsWith("==="));
    assert.deepEqual(lines, [
      "=== author #1929 started 2026-11-03T16:02:00.000Z ===",
      "=== author #1929 started 2026-11-03T18:51:00.000Z ===",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the status says why a queue of ready tickets has nothing eligible", () => {
  // Given: the queue of 12 November: 12 ready tickets, none eligible, eight
  // behind retained branches and one behind an open pull request.
  const queue = summarizeQueue(12, 0, [
    ...[2060, 2058, 2057, 2056, 2050, 2038, 2017, 1864].map((number) => ({
      number,
      reason: `branch sandcastle/issue-${number} exists`,
    })),
    { number: 1930, reason: "claimed by PR #1750" },
    { number: 1928, reason: "held by release-watch" },
  ]);
  // When: an idle pass is described.
  const summary = describeStatus(
    status({ phase: "finished", ticket: null, finishedAt: "2026-11-03T13:58:00.000Z", updatedAt: "2026-11-03T13:58:00.000Z", queue }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // Then: the reader sees the starvation and its causes without the journal.
  assert.equal(
    summary,
    [
      "finished finished, updated 2m ago",
      "  queue: 12 ready, 0 eligible",
      "    8 held back: branch sandcastle/issue-N exists (#2060, #2058, #2057, #2056, #2050, #2038, #2017, #1864)",
      "    1 held back: claimed by PR #N (#1930)",
      "    1 held back: held by release-watch (#1928)",
    ].join("\n"),
  );
});

test("held-back numbers are capped so one reason cannot flood the report", () => {
  // Given: more branch-held tickets than one line should spell out.
  const numbers = Array.from({ length: 14 }, (_, index) => 2000 + index);
  const queue = summarizeQueue(
    14,
    0,
    numbers.map((number) => ({ number, reason: `branch sandcastle/issue-${number} exists` })),
  );
  // When: the pass is described.
  const summary = describeStatus(
    status({ phase: "finished", ticket: null, finishedAt: "2026-11-03T13:58:00.000Z", queue }),
    new Date("2026-11-03T14:00:00.000Z"),
  );
  // Then: the count is complete and the tail is summarized, not silently dropped.
  assert.match(
    summary,
    /14 held back: branch sandcastle\/issue-N exists \(#2000, #2001, #2002, #2003, #2004, #2005, #2006, #2007, #2008, #2009, \+4 more\)/,
  );
  assert.deepEqual(heldByBranch(status({ queue })), numbers);
});

test("a status file written before the queue summary existed still reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-status-"));
  const path = join(dir, "status.json");
  try {
    writeStatus(path, status());
    assert.equal(readStatus(path)?.queue, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
