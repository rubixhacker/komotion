import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acknowledgeEvents,
  enqueueEvent,
  factoryEventKind,
  pendingEvents,
  relevantEvent,
} from "./events.mjs";
import {
  expireMarkers,
  readSnapshot,
  requeueSnapshot,
  writeSnapshot,
} from "./events-cli.mjs";
import { REPO } from "./queue.mjs";

test("acknowledging a sweep preserves events that arrived during its repair", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-events-"));
  try {
    enqueueEvent(directory, "push");
    const snapshot = pendingEvents(directory);
    const later = enqueueEvent(directory, "workflow_run");
    acknowledgeEvents(directory, snapshot);
    assert.deepEqual(pendingEvents(directory), [later]);
    acknowledgeEvents(directory, pendingEvents(directory));
    assert.deepEqual(pendingEvents(directory), []);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("unacknowledged events survive a restarted consumer and partial writes stay invisible", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-events-"));
  try {
    const id = enqueueEvent(directory, "workflow_dispatch");
    writeFileSync(join(directory, "partial.json.tmp"), "{");
    assert.deepEqual(pendingEvents(directory), [id]);
    assert.deepEqual(pendingEvents(directory), [id]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("main pushes and completed Dependabot CI wake reconciliation, unrelated events do not", () => {
  const repository = { full_name: REPO };
  assert.equal(
    relevantEvent("push", { repository, ref: "refs/heads/main" }),
    true,
  );
  assert.equal(
    relevantEvent("push", { repository, ref: "refs/heads/develop" }),
    false,
  );
  assert.equal(
    relevantEvent("workflow_run", {
      repository,
      action: "completed",
      workflow_run: { head_branch: "dependabot/gradle/library" },
    }),
    true,
  );
  assert.equal(
    relevantEvent("workflow_run", {
      repository,
      action: "in_progress",
      workflow_run: { head_branch: "dependabot/gradle/library" },
    }),
    false,
  );
  assert.equal(
    relevantEvent("workflow_run", {
      repository,
      action: "completed",
      workflow_run: { head_branch: "main" },
    }),
    false,
  );
  assert.equal(
    relevantEvent("workflow_run", {
      repository,
      action: "completed",
      workflow_run: { head_branch: "feature/human" },
    }),
    false,
  );
  // A main push already wakes reconciliation; main CI completion changes no Dependabot PR.
  assert.equal(
    relevantEvent("workflow_run", {
      repository,
      action: "completed",
      workflow_run: { head_branch: "main" },
    }),
    false,
  );
  assert.equal(
    relevantEvent("workflow_dispatch", {
      repository: { full_name: "elsewhere/repo" },
    }),
    false,
  );
});

test("only nondraft same-repository Dependabot PR events enter the queue", () => {
  const repository = { full_name: REPO };
  const pull_request = {
    user: { login: "dependabot[bot]" },
    draft: false,
    base: { ref: "main" },
    head: { repo: repository },
  };
  const event = { repository, action: "synchronize", pull_request };
  assert.equal(relevantEvent("pull_request_target", event), true);
  assert.equal(
    relevantEvent("pull_request_target", {
      ...event,
      pull_request: { ...pull_request, draft: true },
    }),
    false,
  );
  assert.equal(
    relevantEvent("pull_request_target", {
      ...event,
      pull_request: { ...pull_request, user: { login: "human" } },
    }),
    false,
  );
  assert.equal(
    relevantEvent("pull_request_target", {
      ...event,
      pull_request: { ...pull_request, head: { repo: null } },
    }),
    false,
  );
  assert.equal(
    relevantEvent("pull_request_target", { ...event, action: "closed" }),
    false,
  );
});

const repository = { full_name: REPO };
const factoryPr = (merged: boolean, ref = "sandcastle/issue-12") => ({
  repository,
  action: "closed",
  pull_request: { merged, head: { ref, repo: repository } },
});

test("the issue factory wakes for a ready label, a factory request closing and its checks", () => {
  const label = (name: string, action = "labeled") => ({ repository, action, label: { name } });
  assert.equal(factoryEventKind("issues", label("ready-for-agent")), "queue");
  assert.equal(factoryEventKind("issues", label("bug")), null);
  assert.equal(factoryEventKind("issues", label("ready-for-agent", "unlabeled")), null);
  assert.equal(factoryEventKind("pull_request_target", factoryPr(true)), "delivery");
  assert.equal(factoryEventKind("pull_request_target", factoryPr(false)), "queue");
  const run = (head_branch: string | null) => ({
    repository,
    action: "completed",
    workflow_run: { head_branch },
  });
  assert.equal(factoryEventKind("workflow_run", run("sandcastle/issue-12")), "delivery");
  assert.equal(factoryEventKind("workflow_run", run("main")), null);
  assert.equal(factoryEventKind("workflow_run", run(null)), null);
  assert.equal(factoryEventKind("workflow_dispatch", { repository }), "queue");
  assert.equal(factoryEventKind("push", { repository }), null);
});

test("the issue factory ignores other repositories, forks and non-factory branches", () => {
  const elsewhere = { full_name: "someone/else" };
  assert.equal(
    factoryEventKind("issues", {
      repository: elsewhere,
      action: "labeled",
      label: { name: "ready-for-agent" },
    }),
    null,
  );
  assert.equal(factoryEventKind("pull_request_target", factoryPr(true, "dependabot/gradle/x")), null);
  assert.equal(factoryEventKind("pull_request_target", factoryPr(true, "sandcastle/issue-12-extra")), null);
  assert.equal(
    factoryEventKind("pull_request_target", {
      ...factoryPr(true),
      pull_request: { merged: true, head: { ref: "sandcastle/issue-12", repo: elsewhere } },
    }),
    null,
  );
});

test("a running pass takes delivery events and leaves queue events for the next start", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-events-"));
  try {
    const queued = enqueueEvent(directory, "issues", "queue-");
    const delivered = enqueueEvent(directory, "workflow_run", "delivery-");
    assert.deepEqual(pendingEvents(directory, "delivery-"), [delivered]);
    acknowledgeEvents(directory, pendingEvents(directory, "delivery-"));
    assert.deepEqual(pendingEvents(directory), [queued]);
    // A second consumer acknowledging the same snapshot finds the file gone.
    acknowledgeEvents(directory, [delivered]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("expiry removes markers older than the configured lifetime", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-events-"));
  try {
    const fresh = enqueueEvent(directory, "workflow_dispatch");
    const stale = enqueueEvent(directory, "push");
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(join(directory, stale), old, old);
    assert.equal(expireMarkers(directory, "", { expirySeconds: 60 }), 1);
    assert.deepEqual(pendingEvents(directory), [fresh]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("an exact snapshot can be requeued after a busy lane", () => {
  const directory = mkdtempSync(join(tmpdir(), "sandcastle-events-"));
  try {
    const first = enqueueEvent(directory, "issues", "queue-");
    const file = join(directory, "snapshot.json");
    writeSnapshot(file, { prefix: "queue-", names: [first] });
    enqueueEvent(directory, "push", "queue-");
    acknowledgeEvents(directory, readSnapshot(file).names);
    assert.equal(pendingEvents(directory, "queue-").length, 1);
    const marker = requeueSnapshot(directory, readSnapshot(file));
    assert.ok(marker !== null);
    assert.equal(pendingEvents(directory, "queue-").length, 2);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
