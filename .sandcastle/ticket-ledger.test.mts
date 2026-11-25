import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HANDOFF_LABEL,
  type RetainedBranch,
  recordDeclines,
  handoffComment,
  handoffDue,
  onlyReady,
  readLedger,
  splitForPlanning,
  ticketDesk,
} from "./ticket-ledger.mjs";
import { parsePlan, queue } from "./queue.mjs";

const MAIN_A = "a".repeat(40);
const MAIN_B = "b".repeat(40);

interface Labelled {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  updatedAt?: string;
}

/**
 * A stand-in for GitHub and the alert script: `gh issue edit` really moves the
 * labels, so the queue computed afterwards reflects the handoff.
 */
function host(issueNumbers: readonly number[]) {
  const issues = new Map<number, Labelled>(
    issueNumbers.map((number) => [
      number,
      {
        number,
        title: `Ticket ${number}`,
        body: "",
        labels: [{ name: "ready-for-agent" }],
        updatedAt: "2026-11-12T00:00:00Z",
      },
    ]),
  );
  const comments = new Map<number, string[]>();
  const alerts: string[] = [];
  const logs: string[] = [];
  const branches = new Map<number, RetainedBranch>();
  const published: string[] = [];
  let pushFailing = false;
  let failing = false;
  let clock = Date.parse("2026-11-12T12:00:00Z");
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ticket-ledger.json");
  const desk = ticketDesk({
    path,
    now: () => {
      clock += 60_000;
      return new Date(clock);
    },
    run: (program, args) => {
      if (failing) throw new Error("gh: could not connect to api.github.com");
      assert.equal(program, "gh");
      const number = Number(args[2]);
      const issue = issues.get(number);
      assert.ok(issue, `unknown issue ${number}`);
      if (args[1] === "comment") {
        comments.set(number, [...(comments.get(number) ?? []), String(args[args.indexOf("--body") + 1])]);
      } else if (args[1] === "edit") {
        const add = args[args.indexOf("--add-label") + 1];
        const remove = args[args.indexOf("--remove-label") + 1];
        issue.labels = [
          ...issue.labels.filter((label) => label.name !== remove),
          { name: String(add) },
        ];
      } else assert.fail(`unexpected gh ${args[1]}`);
      return "";
    },
    branchOf: (issue) => branches.get(issue) ?? null,
    publishBranch: (branch) => {
      if (pushFailing) throw new Error("git: could not reach origin");
      published.push(branch.name);
    },
    alert: (message) => alerts.push(message),
    log: (message) => logs.push(message),
  });
  return {
    desk,
    path,
    issues,
    comments,
    alerts,
    logs,
    branches,
    published,
    failPush: (value: boolean) => {
      pushFailing = value;
    },
    /** The tickets GitHub would list as ready, as the factory's snapshot reads them. */
    ready: () =>
      [...issues.values()].filter((issue) =>
        issue.labels.some((label) => label.name === "ready-for-agent"),
      ),
    failGitHub: (value: boolean) => {
      failing = value;
    },
  };
}

/** One pass's planning step: ask the planner about what is left, strike what it declines. */
function planningPass(
  world: ReturnType<typeof host>,
  originMain: string,
  plannerAnswer: string,
): { asked: number[]; plannerRan: boolean } {
  world.desk.handOffDue();
  const eligible = queue(world.ready(), [], "");
  const split = splitForPlanning(eligible, world.desk.ledger(), originMain);
  for (const entry of split.skipped)
    if (entry.standing) world.desk.needsInteractive(entry.ticket.number, entry.reason);
  if (split.ask.length === 0) return { asked: [], plannerRan: false };
  const plan = parsePlan(plannerAnswer, split.ask, 5);
  recordDeclines(world.desk, plan.declined, split.ask, originMain);
  return { asked: split.ask.map((ticket) => ticket.number), plannerRan: true };
}

const EMPTY_PLAN = '<plan>{"issues":[],"completed":[]}</plan>';

test("a ticket the planner keeps declining leaves the queue with the reason on the issue", () => {
  // Given: the 12 November queue, where an unmerged branch made the planner
  // return an empty plan for the same four tickets pass after pass.
  const world = host([2049, 2056, 2057, 2058]);
  const answer = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [2049, 2056, 2057, 2058].map((id) => ({
      id,
      reason: "covered by unmerged branch origin/integration/v5-finish-2049 (70 commits, no pull request)",
    })),
  })}</plan>`;
  // When: main moves three times and the planner declines each time.
  for (const main of [MAIN_A, MAIN_B, "c".repeat(40)]) planningPass(world, main, answer);
  // Then: every ticket has left the ready queue with a hold label, the reason
  // is written on the issue, and a human was alerted once per ticket.
  assert.deepEqual(queue(world.ready(), [], ""), []);
  for (const number of [2049, 2056, 2057, 2058]) {
    assert.deepEqual(
      world.issues.get(number)?.labels.map((label) => label.name),
      [HANDOFF_LABEL],
    );
    assert.match(world.comments.get(number)?.[0] ?? "", /integration\/v5-finish-2049/);
  }
  assert.equal(world.alerts.length, 4);
  // And: with nothing left to ask, the planner does not run at all.
  assert.deepEqual(planningPass(world, "d".repeat(40), answer), { asked: [], plannerRan: false });
  assert.deepEqual(world.desk.ledger(), {});
});

test("an unexplained empty plan still ends in a handoff, never in silence", () => {
  const world = host([7]);
  for (const main of [MAIN_A, MAIN_B, "c".repeat(40)]) planningPass(world, main, EMPTY_PLAN);
  assert.deepEqual(queue(world.ready(), [], ""), []);
  assert.match(world.comments.get(7)?.[0] ?? "", /no decision or reason/);
});

test("a standing decline hands the ticket to an interactive agent instead of stranding it", () => {
  // Given: one decline at main A.
  const world = host([7]);
  assert.equal(planningPass(world, MAIN_A, EMPTY_PLAN).plannerRan, true);
  // When: the next pass sees the same decline with nothing changed.
  assert.equal(planningPass(world, MAIN_A, EMPTY_PLAN).plannerRan, false);
  // Then: it is routed to an interactive agent now, not left with one strike forever.
  assert.deepEqual(queue(world.ready(), [], ""), []);
  assert.deepEqual(
    world.issues.get(7)?.labels.map((label) => label.name),
    [HANDOFF_LABEL],
  );
  assert.match(world.comments.get(7)?.[0] ?? "", /no decision or reason/);
  assert.deepEqual(world.desk.ledger(), {});
});

test("a declined ticket re-asked after a real change still reaches the strike limit", () => {
  // Given: one decline at main A.
  const world = host([7]);
  planningPass(world, MAIN_A, EMPTY_PLAN);
  // When: a human edits the ticket, then main moves.
  const issue = world.issues.get(7);
  assert.ok(issue);
  issue.updatedAt = "2026-11-12T09:00:00Z";
  assert.deepEqual(planningPass(world, MAIN_A, EMPTY_PLAN).asked, [7]);
  assert.deepEqual(planningPass(world, MAIN_B, EMPTY_PLAN).asked, [7]);
  assert.deepEqual(queue(world.ready(), [], ""), []);
});

test("a retained branch that already spent its resume is handed off at once, with the branch named", () => {
  // Given: sandcastle/issue-2060, which logged "already resumed once; leaving
  // it for a human" 98 times without telling anyone.
  const world = host([2060]);
  world.branches.set(2060, {
    name: "sandcastle/issue-2060",
    head: "2201622345a155426817a653e730151f79f313a5",
    commits: 3,
  });
  // When: the pass meets the spent head.
  world.desk.strike(2060, "resume-exhausted", "head 2201622 was already resumed once");
  // Then: one strike is enough, and the comment says how to earn another run.
  assert.deepEqual(world.ready(), []);
  const comment = world.comments.get(2060)?.[0] ?? "";
  assert.match(comment, /`sandcastle\/issue-2060`/);
  assert.match(comment, /3 undelivered commit\(s\) at `2201622345a1`/);
  assert.match(comment, /has been pushed to the remote/);
  assert.match(comment, /Start the interactive session from that branch/);
  assert.match(comment, /The branch is unverified/);
  assert.deepEqual(world.published, ["sandcastle/issue-2060"]);
  assert.match(world.alerts[0] ?? "", /#2060 .*sandcastle\/issue-2060 holds 3 commit/);
});

test("a handoff whose branch push fails still hands off and says so", () => {
  const world = host([2060]);
  world.branches.set(2060, {
    name: "sandcastle/issue-2060",
    head: "2201622345a155426817a653e730151f79f313a5",
    commits: 3,
  });
  world.failPush(true);
  world.desk.strike(2060, "resume-exhausted", "head already used its resume");
  const comment = world.comments.get(2060)?.[0] ?? "";
  assert.match(comment, /could not be pushed/);
  assert.deepEqual(world.published, []);
  assert.deepEqual(world.ready(), []);
  assert.match(world.logs.join("\n"), /could not publish sandcastle\/issue-2060/);
});

test("three stalled runs of one ticket stop the fourth", () => {
  // Given: a ticket whose author hits the 45-minute budget every time. The
  // empty branch is pruned each pass, so nothing else stops the planner
  // selecting it again.
  const world = host([2031]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(queue(world.ready(), [], "").length, 1, `attempt ${attempt + 1} may run`);
    world.desk.strike(2031, "stalled", "no completion within 45 minutes");
  }
  // Then: the ticket is gone from the queue and the comment lists all three runs.
  assert.deepEqual(queue(world.ready(), [], ""), []);
  assert.equal((world.comments.get(2031)?.[0] ?? "").match(/The author stalled/g)?.length, 3);
  assert.equal(world.alerts.length, 1);
});

test("a ticket that waits on its owner's decision is relabelled at once, without a strike", () => {
  const world = host([2230, 2231]);
  const answer = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [
      { id: 2230, reason: "The issue asks which side of a fold a column moves to", needs: "owner-decision" },
      { id: 2231, reason: "Depends on an open issue" },
    ],
  })}</plan>`;
  // When: one pass plans.
  planningPass(world, "main-1", answer);
  // Then: the first ticket has left the queue with the reason and how to requeue it,
  assert.deepEqual(
    world.issues.get(2230)?.labels.map((label) => label.name),
    ["ready-for-human"],
  );
  const comment = world.comments.get(2230)?.[0] ?? "";
  assert.match(comment, /which side of a fold a column moves to/);
  assert.match(comment, /put `ready-for-agent` back/);
  // and only the ordinary decline is on the ledger.
  assert.deepEqual(Object.keys(world.desk.ledger()), ["2231"]);
  assert.deepEqual(world.alerts, []);
});

test("an owner-decision relabel GitHub refuses is recorded as a decline and tried again", () => {
  const world = host([2230]);
  const answer = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [{ id: 2230, reason: "The owner has not chosen an option", needs: "owner-decision" }],
  })}</plan>`;
  world.failGitHub(true);
  planningPass(world, "main-1", answer);
  assert.equal(world.desk.ledger()["2230"]?.strikes.length, 1);
  assert.deepEqual(world.issues.get(2230)?.labels.map((label) => label.name), ["ready-for-agent"]);
  // When: GitHub answers again and main has moved, so the planner is asked again.
  world.failGitHub(false);
  planningPass(world, "main-2", answer);
  assert.deepEqual(world.issues.get(2230)?.labels.map((label) => label.name), ["ready-for-human"]);
  assert.deepEqual(world.desk.ledger(), {});
});

test("a ticket naming an exact out-of-sandbox target is routed to interactive handoff on the first decline, with no strike", () => {
  const world = host([2240, 2241]);
  const target = "~/.config/systemd/user/caff-conscious.service";
  const targetTicket = world.issues.get(2240);
  assert.ok(targetTicket);
  // The authoring convention: the exact out-of-repo target path is in the body.
  targetTicket.body = `Target file: ${target}\nUpdate the unit so the factory restarts cleanly.`;
  const reason = `Target file ${target} is outside the sandbox`;
  const answer = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [
      { id: 2240, reason, needs: "out-of-sandbox" },
      { id: 2241, reason: "Depends on an open issue" },
    ],
  })}</plan>`;
  planningPass(world, "main-1", answer);
  // Then: the target ticket leaves the queue for an interactive agent, with the reason posted.
  assert.deepEqual(
    world.issues.get(2240)?.labels.map((label) => label.name),
    [HANDOFF_LABEL],
  );
  const comment = world.comments.get(2240)?.[0] ?? "";
  assert.ok(comment.includes(target), "the exact path from the ticket body is on the issue");
  assert.match(comment, /No strike was recorded/);
  assert.match(comment, /put `ready-for-agent` back/);
  // and no strike was recorded for it, so it never enters the three-strike handoff.
  assert.equal(world.desk.ledger()["2240"], undefined);
  assert.deepEqual(Object.keys(world.desk.ledger()), ["2241"]);
  assert.deepEqual(world.alerts, []);
  assert.deepEqual(
    world.ready().map((issue) => issue.number),
    [2241],
  );
});

test("an out-of-sandbox relabel GitHub refuses is recorded as a decline and tried again", () => {
  const world = host([2240]);
  const answer = `<plan>${JSON.stringify({
    issues: [],
    completed: [],
    declined: [
      { id: 2240, reason: "Target file ~/.no-mistakes.yaml is outside the sandbox", needs: "out-of-sandbox" },
    ],
  })}</plan>`;
  world.failGitHub(true);
  planningPass(world, "main-1", answer);
  assert.equal(world.desk.ledger()["2240"]?.strikes.length, 1);
  assert.deepEqual(world.issues.get(2240)?.labels.map((label) => label.name), ["ready-for-agent"]);
  world.failGitHub(false);
  planningPass(world, "main-2", answer);
  assert.deepEqual(world.issues.get(2240)?.labels.map((label) => label.name), [HANDOFF_LABEL]);
  assert.deepEqual(world.desk.ledger(), {});
});

test("a delivered ticket starts clean", () => {
  const world = host([5]);
  world.desk.strike(5, "gate-failed", "detekt");
  world.desk.strike(5, "stalled", "budget");
  world.desk.delivered(5);
  assert.deepEqual(world.desk.ledger(), {});
  world.desk.strike(5, "stalled", "budget");
  assert.equal(world.ready().length, 1);
});

test("a handoff GitHub refuses is retried, and the ticket is not worked in between", () => {
  // Given: a ticket that reaches its limit while GitHub is unreachable.
  const world = host([9]);
  world.failGitHub(true);
  for (let attempt = 0; attempt < 3; attempt += 1) world.desk.strike(9, "blocked", "BLOCKED");
  // Then: it is still labelled ready, but planning holds it back.
  assert.equal(world.ready().length, 1);
  assert.equal(handoffDue(world.desk.ledger(), 9), true);
  const split = splitForPlanning(queue(world.ready(), [], ""), world.desk.ledger(), MAIN_A);
  assert.deepEqual(split.ask, []);
  assert.match(split.skipped[0]?.reason ?? "", /out of attempts/);
  assert.equal(world.alerts.length, 0);
  // When: GitHub is back and the next pass starts.
  world.failGitHub(false);
  world.desk.handOffDue();
  // Then: the handoff completes once.
  assert.deepEqual(world.ready(), []);
  assert.equal(world.comments.get(9)?.length, 1);
  assert.equal(world.alerts.length, 1);
});

test("a ticket a human took out of the queue loses its record", () => {
  const world = host([1, 2]);
  world.desk.strike(1, "stalled", "budget");
  world.desk.strike(2, "stalled", "budget");
  assert.deepEqual(Object.keys(onlyReady(world.desk.ledger(), [2])), ["2"]);
});

test("the comment explains each attempt and how to requeue", () => {
  const comment = handoffComment(
    [
      { at: "2026-11-11T05:33:00Z", kind: "stalled", detail: "no completion within 45 minutes" },
      { at: "2026-11-11T05:44:00Z", kind: "gate-failed", detail: "detekt:\n  2 findings" },
    ],
    null,
  );
  assert.match(comment, /2026-11-11T05:33:00Z: The author stalled — no completion within 45 minutes/);
  assert.match(comment, /The quality gate did not pass — detekt: 2 findings/);
  assert.match(comment, /put `ready-for-agent` back and remove `ready-for-interactive-agent`/);
  assert.doesNotMatch(comment, /Branch `/);
});

test("a resume-exhausted handoff still names the branch, head and remedy", () => {
  const head = "0daf6faba581bba53b4ffd3b56084559026e2429";
  const branch: RetainedBranch = {
    name: "sandcastle/issue-2636",
    head,
    commits: 2,
  };
  const comment = handoffComment(
    [
      {
        at: "2026-11-19T18:41:00Z",
        kind: "resume-exhausted",
        detail: `head ${head.slice(0, 12)} of sandcastle/issue-2636 already used its one resume`,
      },
    ],
    branch,
  );
  assert.match(comment, /The retained branch already used its one resume/);
  assert.match(comment, /Branch `sandcastle\/issue-2636`/);
  assert.match(comment, /`0daf6faba581`/);
  assert.match(comment, /push a new commit to that branch \(a new head earns a fresh resume\) or delete the branch/);
  assert.match(comment, /put `ready-for-agent` back and remove `ready-for-interactive-agent`/);
});

test("an unreadable ledger is empty rather than fatal", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ticket-ledger.json");
  writeFileSync(path, "[1, 2");
  assert.deepEqual(readLedger(path), {});
});

test("a branch the factory can neither resume nor remove is handed off at once", () => {
  // Given: a ticket owned by a branch that exists only on the remote, with no
  // pull request: there is no local branch to resume and nothing to prune.
  const world = host([41]);
  // When: the pass finds it.
  world.desk.strike(41, "stranded-branch", "origin/sandcastle/issue-41 has no open pull request and no local branch");
  // Then: the ticket leaves the queue with the branch named, instead of
  // reading "branch exists" on every pass.
  assert.deepEqual(world.ready(), []);
  assert.match(world.comments.get(41)?.[0] ?? "", /origin\/sandcastle\/issue-41 has no open pull request/);
});
