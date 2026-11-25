import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockedByEdge, GhJsonReader } from "./issue-blockers.mjs";
import {
  describeBlockedBy,
  fetchBlockedBy,
  serializeBlockedBy,
} from "./issue-blockers.mjs";

const reader = (payload: unknown): GhJsonReader => () => JSON.stringify(payload);

test("fetching reads every native edge with its number, title and open/closed state", () => {
  // Given: two pages of native dependencies, one closed with an uppercase state,
  // and a body in the response that must not become blocker data.
  const read = reader([
    [
      {
        number: 2100,
        title: "Ship the snapshot type",
        state: "open",
        body: "Prose that says Blocked by #9999 and must not be read.",
      },
      { number: 2101, title: "Wire the planner context", state: "CLOSED" },
    ],
    [{ number: 2102, title: "Report blockers in status", state: "closed" }],
  ]);
  // When: the host reads the native dependencies for an issue.
  const edges = fetchBlockedBy(read, "rubixhacker/komotion", 2665);
  // Then: every edge survives, with only the three native fields and one state vocabulary.
  assert.deepEqual(edges, [
    { number: 2100, title: "Ship the snapshot type", state: "open" },
    { number: 2101, title: "Wire the planner context", state: "closed" },
    { number: 2102, title: "Report blockers in status", state: "closed" },
  ]);
});

test("fetching asks the native dependency endpoint, never the issue body", () => {
  // Given: a reader that records the gh call and returns an empty page.
  let requested: readonly string[] = [];
  const read: GhJsonReader = (args) => {
    requested = args;
    return "[[]]";
  };
  // When: blockers are fetched.
  assert.deepEqual(fetchBlockedBy(read, "OWNER/REPO", 42), []);
  // Then: the only source is GitHub's blocked_by relationship, for this issue.
  assert.deepEqual(requested, [
    "api",
    "--paginate",
    "--slurp",
    "repos/OWNER/REPO/issues/42/dependencies/blocked_by",
  ]);
});

test("serializing carries only the native fields and survives a context-file round trip", () => {
  // Given: a native edge that still carries the REST response's body.
  const native = [
    {
      number: 2100,
      title: "Ship the snapshot type",
      state: "open" as const,
      body: "Stale prose: Blocked by #9999",
      labels: ["ready-for-agent"],
    },
  ] as unknown as readonly BlockedByEdge[];
  // When: it is serialized into the snapshot that backs the planner context.
  const serialized = serializeBlockedBy(native);
  // Then: only number, title and state travel, and JSON round-tripping is lossless.
  assert.deepEqual(serialized, [
    { number: 2100, title: "Ship the snapshot type", state: "open" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), serialized);
});

test("the planner snapshot carries native edges while leaving body prose untouched", () => {
  // Given: a snapshot whose body mentions a stale blocker in prose and whose
  // native edges name a different, live blocker.
  const snapshot = {
    number: 2665,
    title: "Expose native blocker state",
    body: "## Blocked by\n\n- #9999 old prose blocker",
    blockedBy: serializeBlockedBy([
      { number: 2100, title: "Ship the snapshot type", state: "open" },
    ]),
  };
  // When: the host serializes it into the planner context file.
  const written = JSON.parse(JSON.stringify(snapshot));
  // Then: the file carries the native edge, and the prose never becomes one.
  assert.deepEqual(written.blockedBy, [
    { number: 2100, title: "Ship the snapshot type", state: "open" },
  ]);
  assert.equal(written.body, snapshot.body);
  assert.equal(written.blockedBy.some((edge: { number: number }) => edge.number === 9999), false);
});

test("reporting lists several blockers with their states", () => {
  // Given: an issue held by two blockers in mixed states.
  const edges: BlockedByEdge[] = [
    { number: 2100, title: "Ship the snapshot type", state: "open" },
    { number: 2101, title: "Wire the planner context", state: "closed" },
  ];
  // When: a diagnostic view describes it.
  const report = describeBlockedBy(2665, edges);
  // Then: an operator can see why it is held without opening GitHub.
  assert.equal(
    report,
    '#2665 blocked by #2100 "Ship the snapshot type" (open), #2101 "Wire the planner context" (closed)',
  );
});

test("an issue with no native blockers reports none", () => {
  assert.equal(describeBlockedBy(2665, []), "#2665: no native blockers");
});
