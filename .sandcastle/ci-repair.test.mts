import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CiRepairWorkerNotStartedError,
  entryFromPr,
  planPrRepair,
  readPrFromGitHub,
  runCiRepair,
  runCiRepairEntries,
  type CiRepairHost,
  workerMarksRun,
} from "./ci-repair.mjs";
import { checkRepairMark } from "./ci-sweep.mjs";
import { ListedFactoryPr } from "./factory-prs.mjs";

const head = "a".repeat(40);
const head2 = "b".repeat(40);

function failingPr(overrides: Record<string, unknown> = {}): ListedFactoryPr {
  return ListedFactoryPr.parse({
    number: 42,
    title: "A delivered ticket",
    headRefName: "sandcastle/issue-2006",
    headRefOid: head,
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        status: "COMPLETED",
        conclusion: "FAILURE",
        name: "CI",
        detailsUrl: "https://github.com/org/repo/actions/runs/123",
      },
    ],
    labels: [],
    ...overrides,
  });
}

function fakeHost(options: {
  attempts?: readonly string[];
  alerts?: readonly string[];
  targeted?: readonly string[];
  flakeReruns?: readonly string[];
  failure?: string;
  pr?: ListedFactoryPr;
} = {}): CiRepairHost & {
  readonly alerts: string[];
  readonly repairs: Array<{ issue: number; conflict: boolean; context?: string }>;
  readonly reruns: number[];
  readonly markLog: string[];
  readonly logs: string[];
} {
  const ledgers = new Map<string, Set<string>>([
    ["attempts", new Set(options.attempts ?? [])],
    ["alerts", new Set(options.alerts ?? [])],
    ["targeted", new Set(options.targeted ?? [])],
    ["flakeReruns", new Set(options.flakeReruns ?? [])],
  ]);
  const alerts: string[] = [];
  const repairs: Array<{ issue: number; conflict: boolean; context?: string }> = [];
  const reruns: number[] = [];
  const markLog: string[] = [];
  const logs: string[] = [];
  const paths = {
    attempts: "attempts",
    alerts: "alerts",
    targeted: "targeted",
    flakeReruns: "flakeReruns",
  };
  return {
    paths,
    alerts,
    repairs,
    reruns,
    markLog,
    logs,
    listFactoryPrs: () => [],
    readFactoryPr: () => options.pr ?? failingPr(),
    readHeads: (path) => ledgers.get(path) ?? new Set(),
    recordHead: (path, value) => {
      ledgers.get(path)?.add(value);
    },
    alert: (message) => {
      alerts.push(message);
    },
    log: (message) => logs.push(message),
    failingContext: async () => options.failure ?? "Failing checks: sample test",
    contractHints: () => [],
    rerunFailed: () => {
      reruns.push(1);
    },
    repair: async (pr, issue, conflict, context) => {
      repairs.push({ issue, conflict, ...(context === undefined ? {} : { context }) });
      void pr;
    },
    marks: {
      run: async (values, work) => {
        markLog.push(...values);
        return await work();
      },
    },
    concurrency: 1,
  };
}

test("entryFromPr reads failing checks and conflict state from a factory PR", () => {
  const failing = entryFromPr(failingPr());
  assert.deepEqual(failing, { prNumber: 42, issue: 2006, head, conflict: false });
  const conflicting = entryFromPr(
    failingPr({ mergeable: "CONFLICTING", statusCheckRollup: [] }),
  );
  assert.deepEqual(conflicting, { prNumber: 42, issue: 2006, head, conflict: true });
  assert.equal(entryFromPr(failingPr({ statusCheckRollup: [] })), null);
  assert.equal(entryFromPr(failingPr({ headRefName: "feature/mine" })), null);
  assert.equal(entryFromPr(failingPr({ state: "MERGED" })), null);
});

test("planPrRepair uses planCiSweep and the per-head ledgers", () => {
  const entry = { prNumber: 42, issue: 2006, head, conflict: false };
  const fresh = fakeHost();
  assert.equal(planPrRepair(entry, fresh).kind, "repair");
  const spent = fakeHost({ attempts: [checkRepairMark(42, head)] });
  assert.equal(planPrRepair(entry, spent).kind, "escalate");
  const alerted = fakeHost({
    attempts: [checkRepairMark(42, head)],
    alerts: [`pr:42:${head}`],
  });
  assert.equal(planPrRepair(entry, alerted).kind, "skip");
  const conflictSpent = fakeHost({
    attempts: [checkRepairMark(42, head), `${head}:conflict`],
  });
  assert.equal(
    planPrRepair({ ...entry, conflict: true }, conflictSpent).kind,
    "escalate",
  );
});

test("runCiRepairEntries performs a check repair with a marked head", async () => {
  const host = fakeHost();
  const actions = await runCiRepairEntries(
    [{ pr: failingPr(), issue: 2006, conflict: false }],
    host,
  );
  assert.deepEqual(
    actions.map((action) => action.kind),
    ["repair"],
  );
  assert.deepEqual(host.markLog, [head, checkRepairMark(42, head)]);
  assert.deepEqual(host.repairs, [{ issue: 2006, conflict: false }]);
});

test("runCiRepairEntries rebases a conflict with the conflict mark", async () => {
  const host = fakeHost({ attempts: [checkRepairMark(42, head)] });
  const actions = await runCiRepairEntries(
    [
      {
        pr: failingPr({ mergeable: "CONFLICTING", statusCheckRollup: [] }),
        issue: 2006,
        conflict: true,
      },
    ],
    host,
  );
  assert.deepEqual(
    actions.map((action) => action.kind),
    ["rebase"],
  );
  assert.deepEqual(host.markLog, [`${head}:conflict`]);
  assert.deepEqual(host.repairs, [{ issue: 2006, conflict: true }]);
});

test("runCiRepairEntries escalates once per head and skips repeat events", async () => {
  const host = fakeHost({ attempts: [checkRepairMark(42, head)] });
  const failed = [{ pr: failingPr(), issue: 2006, conflict: false }];
  await runCiRepairEntries(failed, host);
  // The first escalation spends a targeted repair; the next event escalates.
  assert.equal(host.repairs.length, 1);
  assert.equal(host.repairs[0]?.issue, 2006);
  assert.equal(host.repairs[0]?.conflict, false);
  assert.match(host.repairs[0]?.context ?? "", /Failing checks: sample test/);
  assert.deepEqual(host.alerts, []);
  await runCiRepairEntries(failed, host);
  assert.deepEqual(host.alerts, [
    `factory pull request #42 (issue #2006) still fails its checks at ${head.slice(0, 7)}; it needs a human`,
  ]);
  await runCiRepairEntries(failed, host);
  assert.equal(host.alerts.length, 1);
  assert.equal(host.repairs.length, 1);
});

test("runCiRepair re-reads one PR and skips a request that needs no repair", async () => {
  const host = fakeHost();
  const action = await runCiRepair(42, host);
  assert.equal(action?.kind, "repair");
  assert.equal(host.repairs.length, 1);
  const clean = fakeHost({ pr: failingPr({ statusCheckRollup: [] }) });
  assert.equal(await runCiRepair(42, clean), null);
  assert.equal(host.repairs.length, 1);
  assert.equal(clean.repairs.length, 0);
});

test("a flake is re-run before its head spends a repair", async () => {
  const host = fakeHost({ failure: "the build log says Gradle daemon disappeared" });
  await runCiRepairEntries([{ pr: failingPr(), issue: 2006, conflict: false }], host);
  assert.equal(host.repairs.length, 0);
  assert.equal(host.reruns.length, 1);
  assert.deepEqual(host.markLog, []);
});

test("workerMarksRun records marks after a worker that started, but not one that never did", async () => {
  const recorded: string[] = [];
  const run = workerMarksRun("attempts", (path, mark) => {
    assert.equal(path, "attempts");
    recorded.push(mark);
  });
  assert.equal(await run([head], async () => "repaired"), "repaired");
  assert.deepEqual(recorded, [head], "a started worker that succeeds spends the attempt");

  await assert.rejects(
    run([head2], async () => {
      throw new Error("worker crashed after it started");
    }),
    /worker crashed after it started/,
  );
  assert.deepEqual(recorded, [head, head2], "a worker that started and crashed still spends it");

  await assert.rejects(
    run(["not-started"], async () => {
      throw new CiRepairWorkerNotStartedError("lock contention");
    }),
    CiRepairWorkerNotStartedError,
  );
  assert.deepEqual(
    recorded,
    [head, head2],
    "a worker that never started leaves the head free for the next event",
  );
});

test("runCiRepairEntries leaves the attempt unspent when the repair worker never starts", async () => {
  const base = fakeHost();
  const host: typeof base = {
    ...base,
    repair: async () => {
      throw new CiRepairWorkerNotStartedError("worker never started");
    },
    marks: {
      run: workerMarksRun("attempts", (path, mark) => {
        assert.equal(path, "attempts");
        base.markLog.push(mark);
      }),
    },
  };
  const actions = await runCiRepairEntries(
    [{ pr: failingPr(), issue: 2006, conflict: false }],
    host,
  );
  assert.deepEqual(
    actions.map((action) => action.kind),
    ["repair"],
  );
  assert.deepEqual(host.markLog, [], "the error is logged, not charged to the head");
  assert.match(host.logs.join("\n"), /worker never started/);
});

test("readPrFromGitHub reads a PR by number with the sweep fields", () => {
  const raw = JSON.stringify(failingPr({ headRefOid: head2 }));
  const calls: string[][] = [];
  const pr = readPrFromGitHub(42, (program, args) => {
    calls.push([program, ...args]);
    return raw;
  });
  assert.equal(pr.number, 42);
  assert.equal(pr.headRefOid, head2);
  assert.deepEqual(calls[0], [
    "gh",
    "pr",
    "view",
    "42",
    "--repo",
    "rubixhacker/komotion",
    "--json",
    "number,title,headRefName,headRefOid,baseRefName,state,isDraft,isCrossRepository,mergeable,mergeStateStatus,statusCheckRollup,labels",
  ]);
});
