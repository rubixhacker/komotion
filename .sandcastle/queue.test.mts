import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockedByEdge } from "./issue-blockers.mjs";
import {
  INFLIGHT_LABEL,
  UNEXPLAINED_DECLINE,
  branchSnapshot,
  commitClosesIssue,
  couldDeliverWork,
  isDocumentationPath,
  parsePlan,
  queue,
  releaseReason,
  heldBack,
  mainlineMentions,
  retained,
} from "./queue.mjs";
const ticket = (number: number, labels = ["ready-for-agent"]) => ({
  number,
  title: "Work",
  body: "",
  labels: labels.map((name) => ({ name })),
});
const blockedTicket = (
  number: number,
  blockedBy: BlockedByEdge[] | undefined,
  body = "",
) => ({ ...ticket(number), body, blockedBy });
test("run-local tickets stay eligible while ownership and human holds still exclude work", () => {
  // Given: ready local work, human/info holds, an open PR, and a preserved branch.
  const issues = [
    ticket(1),
    ticket(2, ["ready-for-agent", "run-local"]),
    ticket(3),
    ticket(4),
    ticket(5, ["needs-info"]),
    ticket(6, ["ready-for-agent", "run-local", "ready-for-human"]),
  ];
  const prs = [
    { number: 9, title: "Fix", body: "Addresses #3.", headRefName: "fix/task" },
  ];
  // When: the factory selects the queue.
  const selected = queue(issues, prs, "sandcastle/issue-4\n");
  // Then: both unowned ready tickets remain, including run-local.
  assert.deepEqual(
    selected.map((issue) => issue.number),
    [1, 2],
  );
});
test("device-evidence-pending holds a ready ticket out of the factory", () => {
  // Given: ready work, and ready local work that only a device-capable session can finish.
  const issues = [
    ticket(1),
    ticket(2, ["ready-for-agent", "run-local", "device-evidence-pending"]),
  ];
  // When: the factory selects the queue.
  const selected = queue(issues, [], "");
  // Then: the evidence-only ticket stays for a local session.
  assert.deepEqual(
    selected.map((issue) => issue.number),
    [1],
  );
});
test("ready-for-interactive-agent holds a ticket out of the factory even if it is still ready", () => {
  // Given: ready work, and a ticket the factory gave up on that kept its ready label.
  const issues = [ticket(1), ticket(2, ["ready-for-agent", "ready-for-interactive-agent"])];
  // When: the factory selects the queue.
  const selected = queue(issues, [], "");
  // Then: only the owner's interactive session picks up the handed-off ticket.
  assert.deepEqual(
    selected.map((issue) => issue.number),
    [1],
  );
});
test("a stale factory-inflight claim holds a ready ticket out of the queue", () => {
  // Given: ready work and a ticket whose worker claimed it with the label.
  const issues = [ticket(1), ticket(2, ["ready-for-agent", INFLIGHT_LABEL])];
  // When: the factory reads the queue.
  const selected = queue(issues, [], "");
  // Then: no second worker can start on the claimed ticket.
  assert.deepEqual(
    selected.map((issue) => issue.number),
    [1],
  );
  assert.match(heldBack(issues, [], "")[0]?.reason ?? "", /held by factory-inflight/);
});

test("an issue number prefix does not create false ownership", () => {
  // Given: issue 12 and work on issue 123.
  const issues = [ticket(12)];
  const prs = [
    {
      number: 9,
      title: "Fix",
      body: "Addresses #123",
      headRefName: "sandcastle/issue-123",
    },
  ];
  // When: ownership is checked.
  const selected = queue(issues, prs, "sandcastle/issue-123");
  // Then: issue 12 remains eligible.
  assert.equal(selected.length, 1);
});
test("a planner cannot dispatch an issue outside the eligible queue", () => {
  // Given: the planner selects a ticket removed by the host policy.
  const output = '<plan>{"issues":[{"id":2,"title":"Local work"}]}</plan>';
  // When / Then: parsing refuses dispatch.
  assert.throws(() => parsePlan(output, [ticket(1)], 1), /ineligible/);
});
test("malformed plans fail closed", () => {
  // Given: an incorrectly typed issue ID.
  const output = '<plan>{"issues":[{"id":"1","title":"Work"}]}</plan>';
  // When / Then: parsing refuses dispatch.
  assert.throws(() => parsePlan(output, [ticket(1)], 1));
});
test("all-blocked plans can leave the queue pending", () => {
  // Given: no actionable issue chosen by the planner.
  const output = '<plan>{"issues":[]}</plan>';
  // When: the host parses the result.
  const selected = parsePlan(output, [ticket(1)], 1);
  // Then: no fallback issue is forced into execution, and the ticket the
  // planner passed over is on record as declined.
  assert.deepEqual(selected.issues, []);
  assert.deepEqual(selected.completed, []);
  assert.deepEqual(selected.declined, [
    { number: 1, reason: UNEXPLAINED_DECLINE, ownerDecision: false, outOfSandbox: false },
  ]);
});

test("GitHub-linked open PRs exclude a ticket even without textual issue references", () => {
  // Given: an open PR linked through GitHub metadata only.
  const prs = [
    {
      number: 9,
      title: "Fix",
      body: "",
      headRefName: "fix/work",
      closingIssuesReferences: [{ number: 1 }],
    },
  ];
  // When: the factory checks ownership.
  const selected = queue([ticket(1)], prs, "");
  // Then: it cannot dispatch the linked issue.
  assert.deepEqual(selected, []);
});

test("completed issue evidence survives planning for host-side closure", () => {
  // Given: the planner found the whole issue completed in one mainline commit.
  const completed = [
    {
      id: 1,
      commit: "a".repeat(40),
      reason: "All acceptance criteria satisfied on main.",
    },
  ];
  const stdout = `<plan>${JSON.stringify({ issues: [], completed })}</plan>`;
  // When: the host parses the plan.
  const result = parsePlan(stdout, [ticket(1)], 1);
  // Then: completion evidence is retained instead of silently skipped.
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.completed, completed);
  assert.deepEqual(result.declined, []);
});

test("only a closing keyword counts as issue-completion evidence", () => {
  assert.equal(commitClosesIssue("Fixes #12\n", 12), true);
  assert.equal(commitClosesIssue("Also closes: #12.", 12), true);
  assert.equal(commitClosesIssue("See #12 for context", 12), false);
  assert.equal(commitClosesIssue("Fixes #123", 12), false);
});

test("a planner cannot close an issue excluded from its candidate queue", () => {
  // Given: a proposed closure for an issue with another owner.
  const stdout = `<plan>${JSON.stringify({ issues: [], completed: [{ id: 2, commit: "a".repeat(40), reason: "Done" }] })}</plan>`;
  // When / Then: the host refuses the closure request.
  assert.throws(() => parsePlan(stdout, [ticket(1)], 1), /ineligible/);
});

test("an issue cannot be both completed and assigned for implementation", () => {
  // Given: contradictory planning outcomes for one issue.
  const stdout = `<plan>${JSON.stringify({ issues: [{ id: 1, title: "Work" }], completed: [{ id: 1, commit: "a".repeat(40), reason: "Done" }] })}</plan>`;
  // When / Then: parsing prevents double disposition.
  assert.throws(() => parsePlan(stdout, [ticket(1)], 1), /duplicate/);
});

test("a ticket held back by an existing branch says so, by number", () => {
  // Given: one ready ticket whose branch a stalled run left behind, and one free ticket.
  const issues = [ticket(1876), ticket(1900)];
  // When: the held-back list is built with that branch present.
  const blocked = heldBack(issues, [], "sandcastle/issue-1876\n");
  // Then: the reason names the exact condition an operator has to clear.
  assert.deepEqual(blocked, [
    {
      number: 1876,
      title: "Work",
      reason: "branch sandcastle/issue-1876 exists",
    },
  ]);
});

test("a ticket claimed by an open PR reports the PR number", () => {
  // Given: a ready ticket an open PR already closes.
  const prs = [
    {
      number: 1938,
      title: "Cover the logging surfaces",
      body: "Closes #1930",
      headRefName: "test/1930-ios-logging-coverage",
    },
  ];
  // When: the held-back list is built.
  const blocked = heldBack([ticket(1930)], prs, "");
  // Then: the operator sees which PR owns it instead of an empty queue slot.
  assert.equal(blocked[0]?.reason, "claimed by PR #1938");
});

test("no native blockers means eligible even when the body mentions a blocker in prose", () => {
  // Given: a ready ticket with no native edges whose body still says Blocked by #9999.
  const issue = blockedTicket(1, [], "## Blocked by\n\n- #9999 stale prose");
  // When: the queue is built from the snapshot.
  // Then: prose alone gates nothing.
  assert.deepEqual(heldBack([issue], [], ""), []);
  assert.deepEqual(queue([issue], [], "").map((entry) => entry.number), [1]);
});

test("one open native blocker holds a ready ticket with a reason naming it", () => {
  // Given: a ready ticket with a live native edge and a stale prose line for a
  // different number; both forms coexist during the transition.
  const issue = blockedTicket(
    2666,
    [{ number: 2665, title: "Expose native blocker state", state: "open" }],
    "## Blocked by\n\n- #9999 prose that must not be read",
  );
  // When: the queue is built.
  const blocked = heldBack([issue], [], "");
  // Then: the issue is held once, and the reason names the native edge, not prose.
  assert.deepEqual(queue([issue], [], ""), []);
  assert.deepEqual(blocked, [
    {
      number: 2666,
      title: "Work",
      reason: 'blocked by #2665 "Expose native blocker state" (open)',
    },
  ]);
});

test("several native blockers in mixed states hold only on the open ones", () => {
  // Given: three edges, two still open, one already closed, and prose too.
  const issue = blockedTicket(2, [
    { number: 2100, title: "Ship the snapshot type", state: "open" },
    { number: 2101, title: "Wire the planner context", state: "closed" },
    { number: 2102, title: "Report blockers in status", state: "open" },
  ]);
  // When: the held-back report is built.
  const blocked = heldBack([issue], [], "");
  // Then: one hold names every open blocker and ignores the closed one.
  assert.equal(blocked.length, 1);
  assert.equal(
    blocked[0]?.reason,
    'blocked by #2100 "Ship the snapshot type" (open), #2102 "Report blockers in status" (open)',
  );
});

test("a blocker closing between passes makes the issue eligible without a label change", () => {
  // Given: the same ready ticket in two passes; only the edge's live state changed.
  const edge = { number: 2665, title: "Expose native blocker state" };
  const held = blockedTicket(2666, [{ ...edge, state: "open" }]);
  const released = blockedTicket(2666, [{ ...edge, state: "closed" }]);
  // When / Then: the first pass holds it and the next pass does not, with the
  // same labels and no edit to the prose in its body.
  assert.deepEqual(queue([held], [], ""), []);
  assert.match(heldBack([held], [], "")[0]?.reason ?? "", /#2665/);
  assert.deepEqual(queue([released], [], "").map((entry) => entry.number), [2666]);
  assert.deepEqual(heldBack([released], [], ""), []);
});

test("the held-back list and the queue are exact complements", () => {
  // Given: a mixed queue of free, held, claimed and unlabelled tickets.
  const issues = [
    ticket(1),
    ticket(2, ["ready-for-agent", "needs-info"]),
    ticket(3),
    ticket(4, []),
  ];
  const prs = [
    { number: 9, title: "Fix", body: "Addresses #3.", headRefName: "fix/task" },
  ];
  // When: both lists are derived from the same snapshot.
  const eligible = queue(issues, prs, "").map((issue) => issue.number);
  const blocked = heldBack(issues, prs, "").map((entry) => entry.number);
  // Then: every ticket appears exactly once, which is what makes the report trustworthy.
  assert.deepEqual(eligible, [1]);
  assert.deepEqual(blocked, [2, 3, 4]);
  assert.deepEqual([...eligible, ...blocked].sort(), [1, 2, 3, 4]);
});

test("retained resumes only branch-owned tickets with no PR and no hold", () => {
  // Given: a stranded branch, a branch already claimed by a PR, and a branch on hold.
  const issues = [
    ticket(1),
    ticket(2),
    ticket(3, ["ready-for-agent", "needs-info"]),
    ticket(4),
  ];
  const prs = [
    {
      number: 9,
      title: "Fix",
      body: "Addresses #2.",
      headRefName: "sandcastle/issue-2",
    },
  ];
  const branches = "sandcastle/issue-1\nsandcastle/issue-2\nsandcastle/issue-3\n";
  // When: the pass looks for committed but undelivered work.
  // Then: only the unclaimed, unheld branch is resumed; the free ticket waits for the plan.
  assert.deepEqual(
    retained(issues, prs, branches).map((issue) => issue.number),
    [1],
  );
});


test("every candidate comes back selected, completed or declined", () => {
  // Given: four candidates; the planner selects one, completes one, declines
  // one with a reason and never mentions the fourth.
  const stdout = `<plan>${JSON.stringify({
    issues: [{ id: 1, title: "Work" }],
    completed: [{ id: 2, commit: "a".repeat(40), reason: "Done" }],
    declined: [{ id: 3, reason: " covered by unmerged branch integration/v5-finish " }],
  })}</plan>`;
  // When: the host reads the plan.
  const plan = parsePlan(stdout, [ticket(1), ticket(2), ticket(3), ticket(4)], 5);
  // Then: the four candidates are partitioned with nothing left over.
  assert.deepEqual(plan.issues.map((issue) => issue.number), [1]);
  assert.deepEqual(plan.completed.map((done) => done.id), [2]);
  assert.deepEqual(plan.declined, [
    { number: 3, reason: "covered by unmerged branch integration/v5-finish", ownerDecision: false, outOfSandbox: false },
    { number: 4, reason: UNEXPLAINED_DECLINE, ownerDecision: false, outOfSandbox: false },
  ]);
});

test("a decline that waits on the owner's decision is marked, but only with a reason", () => {
  const stdout = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [
      { id: 1, reason: "The issue asks the owner which side of the fold a column moves to", needs: "owner-decision" },
      { id: 2, reason: "", needs: "owner-decision" },
      { id: 3, reason: "Depends on an open issue", needs: "a-dependency" },
      { id: 4, reason: "Needs device access", needs: 7 },
    ],
  })}</plan>`;
  const plan = parsePlan(stdout, [ticket(1), ticket(2), ticket(3), ticket(4)], 5);
  assert.deepEqual(
    plan.declined.map((entry) => [entry.number, entry.ownerDecision]),
    [
      [1, true],
      // Nothing to tell the owner, an unknown need, and a malformed one: ordinary declines.
      [2, false],
      [3, false],
      [4, false],
    ],
  );
});

test("a decline for an exact out-of-sandbox target is marked, but only with a reason", () => {
  // Given: a ticket whose body names its exact out-of-repo target, and declines
  // with the path copied into the reason as the authoring convention requires.
  const stdout = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [
      {
        id: 1,
        reason: "Target file ~/.config/systemd/user/caff-conscious.service is outside the sandbox",
        needs: "out-of-sandbox",
      },
      { id: 2, reason: "", needs: "out-of-sandbox" },
      { id: 3, reason: "Inside the repository", needs: "in-the-repo" },
      { id: 4, reason: "Malformed need", needs: 7 },
    ],
  })}</plan>`;
  const plan = parsePlan(
    stdout,
    [
      { ...ticket(1), body: "Target file: ~/.config/systemd/user/caff-conscious.service" },
      ticket(2),
      ticket(3),
      ticket(4),
    ],
    5,
  );
  assert.deepEqual(
    plan.declined.map((entry) => [entry.number, entry.outOfSandbox, entry.ownerDecision]),
    [
      [1, true, false],
      // No reason, an unknown need and a malformed one: ordinary declines.
      [2, false, false],
      [3, false, false],
      [4, false, false],
    ],
  );
  assert.match(plan.declined[0]?.reason ?? "", /caff-conscious\.service/);
});

test("the empty plan of 12 November declines every candidate instead of passing silently", () => {
  // Given: the literal answer that starved four tickets for a day.
  const stdout = 'analysis...\n<plan>{"issues":[],"completed":[]}</plan>\nAgent stopped';
  // When: the host reads it against the four candidates.
  const plan = parsePlan(stdout, [ticket(2049), ticket(2056), ticket(2057), ticket(2058)], 5);
  // Then: each one is a recorded decline the host can count.
  assert.deepEqual(
    plan.declined.map((entry) => entry.number),
    [2049, 2056, 2057, 2058],
  );
});

test("a selected ticket beyond the pass cap is overflow, not a decline", () => {
  const stdout = `<plan>${JSON.stringify({
    issues: [
      { id: 1, title: "Work" },
      { id: 2, title: "Work" },
    ],
  })}</plan>`;
  const plan = parsePlan(stdout, [ticket(1), ticket(2)], 1);
  assert.deepEqual(plan.issues.map((issue) => issue.number), [1]);
  assert.deepEqual(plan.overflow.map((issue) => issue.number), [2]);
  assert.deepEqual(plan.declined, []);
});

test("a decline cannot override a selection or name a ticket outside the queue", () => {
  const stdout = `<plan>${JSON.stringify({
    issues: [{ id: 1, title: "Work" }],
    declined: [
      { id: 1, reason: "contradiction" },
      { id: 99, reason: "not a candidate" },
    ],
  })}</plan>`;
  const plan = parsePlan(stdout, [ticket(1)], 1);
  assert.deepEqual(plan.issues.map((issue) => issue.number), [1]);
  assert.deepEqual(plan.declined, []);
});

test("an answer with no plan block fails with a sentence a human can read", () => {
  // Given: a planner that ran out of turns before answering, which used to
  // surface as a raw schema error array.
  assert.throws(
    () => parsePlan("Reached max iterations (1).", [ticket(1)], 1),
    /The planner returned no <plan> block/,
  );
  assert.throws(
    () => parsePlan("<plan>{not json</plan>", [ticket(1)], 1),
    /not valid JSON/,
  );
});

test("a ticket branch deleted on the remote stops blocking its ticket", () => {
  // Given: the local branches, and the remote's own list of Sandcastle heads.
  // origin/sandcastle/issue-7 was deleted on GitHub; only a stale tracking ref
  // of it remains locally, and tracking refs are not part of the snapshot.
  const branches = branchSnapshot(
    "main\nsandcastle/issue-4\n",
    `${"a".repeat(40)}\trefs/heads/sandcastle/issue-9\n`,
  );
  // When: the queue is computed.
  const issues = [ticket(4), ticket(7), ticket(9)];
  // Then: the live local and remote branches still own their tickets, and
  // ticket 7 is eligible again.
  assert.deepEqual(queue(issues, [], branches).map((issue) => issue.number), [7]);
  assert.deepEqual(
    heldBack(issues, [], branches).map((entry) => entry.reason),
    ["branch sandcastle/issue-4 exists", "branch sandcastle/issue-9 exists"],
  );
});

test("a main commit naming a ready issue holds it for a human instead of rebuilding it", () => {
  // Given: issue 2057 made ready at t=100, and an integration PR's commits rebase-merged at t=200.
  const commits = [
    { sha: "a".repeat(40), time: 200, message: "fix(ui): finish chart gaps found in review of #2057\n" },
    { sha: "b".repeat(40), time: 200, message: "feat(copy): one glossary (#20571)\n" },
    { sha: "c".repeat(40), time: 50, message: "docs: plan for #2058\n" },
  ];
  // When: the host reads mentions since each issue became ready.
  const mentions = mainlineMentions(
    new Map([
      [2057, 100],
      [2058, 100],
      [20, 100],
    ]),
    commits,
  );
  // Then: only the later, exact mention counts; an older plan or a longer number does not.
  assert.deepEqual([...mentions], [[2057, "a".repeat(40)]]);
  const held = { ...ticket(2057), mainlineMention: "a".repeat(40) };
  assert.deepEqual(queue([held], [], ""), []);
  assert.deepEqual(retained([held], [], "sandcastle/issue-2057\n"), []);
  assert.match(heldBack([held], [], "")[0]?.reason ?? "", /^named by main commit aaaaaaaaa /);
});

test("labelling an issue ready again releases a main commit's hold", () => {
  // Given: the commit at t=200 named issue 7, and a human relabelled it at t=300.
  const commits = [{ sha: "d".repeat(40), time: 200, message: "Refs #7" }];
  // When: the host reads mentions since the newest ready label.
  const mentions = mainlineMentions(new Map([[7, 300]]), commits);
  // Then: the issue is queued again.
  assert.equal(mentions.size, 0);
  assert.deepEqual(queue([ticket(7)], [], "").map((issue) => issue.number), [7]);
});

test("a documentation-only main commit naming an issue does not hold it", () => {
  // Given: issue 2007 made ready at t=100, a docs decision record naming it at
  // t=300, and an older code commit naming issue 2008 at t=200.
  const docs = { sha: "e".repeat(40), time: 300, message: "docs: record decisions\n\nRefs #2007 #2008\n" };
  const code = { sha: "f".repeat(40), time: 200, message: "feat: start #2008\n" };
  const paths = new Map([
    [docs.sha, ["docs/adr/0090-slices.md", "CONTEXT.md"]],
    [code.sha, ["shared/feature/x/internal/src/commonMain/kotlin/X.kt"]],
  ]);
  const asked: string[] = [];
  // When: the host skips commits that could not deliver work.
  const mentions = mainlineMentions(
    new Map([
      [2007, 100],
      [2008, 100],
      [2009, 100],
    ]),
    [docs, code],
    (commit) => {
      asked.push(commit.sha);
      return couldDeliverWork(paths.get(commit.sha) ?? []);
    },
  );
  // Then: 2007 is free, 2008 is held by the code commit behind the docs one,
  // and only commits that name an issue are inspected.
  assert.deepEqual([...mentions], [[2008, code.sha]]);
  assert.deepEqual([...new Set(asked)].sort(), [docs.sha, code.sha].sort());
});

test("only documentation paths count as documentation", () => {
  assert.equal(isDocumentationPath("docs/agents/domain.md"), true);
  assert.equal(isDocumentationPath("docs/media-storage-inventory.json"), true);
  assert.equal(isDocumentationPath("CONTEXT.md"), true);
  assert.equal(isDocumentationPath("etl/README.MDX"), true);
  assert.equal(isDocumentationPath(".sandcastle/implement-prompt.md"), false);
  assert.equal(isDocumentationPath(".claude/skills/pr/SKILL.md"), false);
  assert.equal(isDocumentationPath("androidApp/src/main/kotlin/A.kt"), false);
  assert.equal(couldDeliverWork(["docs/a.md", "src/B.kt"]), true);
  assert.equal(couldDeliverWork([]), true);
  assert.equal(couldDeliverWork(["README.md", "docs/x.json"]), false);
  // A factory/CI fix that mentions an issue in its body cannot have delivered that ticket.
  assert.equal(couldDeliverWork([".sandcastle/mac-compile.mts", ".sandcastle/mac-compile.test.mts"]), false);
  assert.equal(couldDeliverWork(["scripts/ci/ios-compile.sh"]), false);
  assert.equal(couldDeliverWork([".github/workflows/ci.yml", "docs/adr/x.md"]), false);
  // A real delivery still holds the issue even when it also touches factory files.
  assert.equal(couldDeliverWork([".sandcastle/delivery.md", "shared/feature/x/X.kt"]), true);
});

test("a worker's own claim label is informational, not ownership or a release reason", () => {
  // Given: a ready ticket whose worker just claimed it.
  const claimed = ticket(7, ["ready-for-agent", INFLIGHT_LABEL]);
  // Then: the ownership watch does not abort that worker for its own label.
  assert.equal(releaseReason(7, [claimed], []), null);
  // And: a retained branch is still what marks it resumable, not the label.
  assert.deepEqual(retained([claimed], [], "sandcastle/issue-7\n"), [claimed]);
  // But: a fresh worker still cannot pick up the same ticket while it is labelled.
  assert.deepEqual(queue([claimed], [], "sandcastle/issue-7\n"), []);
});

test("a ticket the factory started is released when it closes or another request claims it", () => {
  const pr = (number: number, body: string, headRefName = "feature") => ({
    number,
    title: "Work",
    body,
    headRefName,
  });
  // Still open, ready and unclaimed: its own branch does not count against it.
  assert.equal(releaseReason(7, [ticket(7)], []), null);
  // Closed, or relabelled: it is no longer in the open ready list.
  assert.equal(
    releaseReason(7, [ticket(8)], []),
    "the issue is closed or no longer labelled ready-for-agent",
  );
  // Another session opened a request for it.
  assert.equal(releaseReason(7, [ticket(7)], [pr(41, "Closes #7")]), "claimed by PR #41");
  // The owner put it on hold.
  assert.equal(
    releaseReason(7, [ticket(7, ["ready-for-agent", "ready-for-human"])], []),
    "held by ready-for-human",
  );
});
