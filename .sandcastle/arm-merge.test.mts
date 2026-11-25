import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EXPECTED_CHECKS } from "./dependabot-policy.mjs";
import type { FactoryPr } from "./factory-ci.mjs";
import { armFactoryPr, armMergeDecision, autoMergePolicyFromEnv } from "./arm-merge.mjs";

const HEAD = "a".repeat(40);
const MOVED_HEAD = "b".repeat(40);

function pr(overrides: Partial<FactoryPr> = {}): FactoryPr {
  return {
    number: 42,
    headRefName: "sandcastle/issue-2794",
    headRefOid: HEAD,
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: EXPECTED_CHECKS.map(([workflowName, name]) => ({
      __typename: "CheckRun" as const,
      workflowName,
      name,
      status: "COMPLETED",
      conclusion: "SUCCESS",
    })),
    labels: [],
    ...overrides,
  };
}

type StubOptions = {
  readonly first?: FactoryPr;
  readonly second?: FactoryPr;
  readonly state?: unknown;
  readonly armedState?: unknown;
  readonly reviews?: unknown;
  readonly files?: readonly string[];
  /** Exit code of `git merge-base --is-ancestor origin/main <head>`. */
  readonly ancestor?: number;
  /** Exit code of `gh pr merge`; a failure is treated as a concurrent arm. */
  readonly armExit?: number;
};

interface Stub {
  readonly root: string;
  readonly log: () => string;
  readonly restore: () => void;
  readonly dispose: () => void;
}

/**
 * A host-shaped `gh` and `git` on PATH. The pull request read is counted so a
 * test can move the head between the first decision and the exact-head call;
 * every invocation is logged so a test can prove the refresh happened first.
 */
function withStubs(options: StubOptions = {}): Stub {
  const base = mkdtempSync(join(tmpdir(), "sandcastle-arm-merge-"));
  const root = join(base, "root");
  const bin = join(base, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  const paths = {
    log: join(base, "calls.log"),
    first: join(base, "first.json"),
    second: join(base, "second.json"),
    state: join(base, "state.json"),
    armed: join(base, "armed.json"),
    reviews: join(base, "reviews.json"),
    files: join(base, "files.json"),
    count: join(base, "count"),
    ancestor: join(base, "ancestor"),
  };
  writeFileSync(paths.first, JSON.stringify(options.first ?? pr()));
  writeFileSync(paths.second, JSON.stringify(options.second ?? options.first ?? pr()));
  writeFileSync(
    paths.state,
    JSON.stringify(options.state ?? { state: "OPEN", autoMergeRequest: null }),
  );
  writeFileSync(
    paths.armed,
    JSON.stringify(
      options.armedState ?? { state: "OPEN", autoMergeRequest: { mergeMethod: "REBASE" } },
    ),
  );
  writeFileSync(paths.reviews, JSON.stringify(options.reviews ?? [[]]));
  writeFileSync(
    paths.files,
    JSON.stringify((options.files ?? ["README.md"]).map((filename) => ({ filename }))),
  );
  writeFileSync(paths.count, "0");
  writeFileSync(paths.ancestor, String(options.ancestor ?? 0));

  const gh = join(bin, "gh");
  writeFileSync(
    gh,
    [
      "#!/bin/bash",
      `echo "gh $*" >> "${paths.log}"`,
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
      '  for arg in "$@"; do',
      '    if [ "$arg" = "state,autoMergeRequest" ]; then',
      `      cat "${paths.state}"`,
      "      exit 0",
      "    fi",
      "  done",
      `  n=$(cat "${paths.count}")`,
      `  echo $((n + 1)) > "${paths.count}"`,
      '  if [ "$n" -eq 0 ]; then',
      `    cat "${paths.first}"`,
      "  else",
      `    cat "${paths.second}"`,
      "  fi",
      "  exit 0",
      "fi",
      'if [ "$1" = "api" ]; then',
      '  case "$*" in',
      `    *"/reviews?"*) cat "${paths.reviews}"; exit 0 ;;`,
      `    *"/files?"*) cat "${paths.files}"; exit 0 ;;`,
      "  esac",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then',
      `  cp "${paths.armed}" "${paths.state}"`,
      `  exit ${options.armExit ?? 0}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  const git = join(bin, "git");
  writeFileSync(
    git,
    [
      "#!/bin/bash",
      `echo "git $*" >> "${paths.log}"`,
      'case "$1" in',
      "  fetch|cat-file|show-ref|cherry) exit 0 ;;",
      `  rev-parse) echo "${HEAD}"; exit 0 ;;`,
      `  merge-base) exit $(cat "${paths.ancestor}") ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  chmodSync(git, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  return {
    root,
    log: () => readFileSync(paths.log, "utf8"),
    restore: () => {
      process.env.PATH = oldPath;
    },
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

function approval(commit = HEAD) {
  return {
    id: 1,
    state: "APPROVED",
    commit_id: commit,
    submitted_at: "2026-11-23T12:00:00Z",
    author_association: "OWNER",
    user: { login: "stewart", type: "User" },
  };
}

test("the default trust bar is green, and an explicit policy still wins", () => {
  assert.equal(autoMergePolicyFromEnv({}), "green");
  assert.equal(autoMergePolicyFromEnv({ SANDCASTLE_AUTO_MERGE: "approval" }), "approval");
  assert.equal(autoMergePolicyFromEnv({ SANDCASTLE_AUTO_MERGE: "green" }), "green");
});

test("arms an exact green head with a current human approval after refreshing every fact", () => {
  const stub = withStubs({ reviews: [[approval()]] });
  try {
    const result = armFactoryPr(stub.root, 42, "approval");
    assert.deepEqual(result, { action: "armed", head: HEAD });
    const log = stub.log();
    const fetch = log.indexOf("git fetch origin main");
    const merge = log.indexOf(`gh pr merge 42 --repo rubixhacker/komotion --auto --squash --match-head-commit ${HEAD}`);
    assert.ok(fetch >= 0 && merge > fetch, "main must be refetched before the exact-head merge");
    assert.equal(log.split(`--match-head-commit ${HEAD}`).length - 1, 1);
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("a head that moves between the decision and the call is never armed", () => {
  const stub = withStubs({
    first: pr(),
    second: pr({ headRefOid: MOVED_HEAD }),
    reviews: [[approval()]],
  });
  try {
    assert.equal(armFactoryPr(stub.root, 42, "approval").action, "wait");
    assert.equal(stub.log().includes("gh pr merge"), false);
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("a pull request touching factory plumbing waits under an authorized approval", () => {
  const stub = withStubs({ reviews: [[approval()]], files: [".github/workflows/ci.yml"] });
  try {
    assert.equal(armFactoryPr(stub.root, 42, "approval").action, "wait");
    assert.equal(stub.log().includes("gh pr merge"), false);
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("a head that does not include current main waits", () => {
  const stub = withStubs({ reviews: [[approval()]], ancestor: 1 });
  try {
    assert.equal(armFactoryPr(stub.root, 42, "approval").action, "wait");
    assert.equal(stub.log().includes("gh pr merge"), false);
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("the green policy arms a green head without a human approval", () => {
  const stub = withStubs();
  try {
    assert.deepEqual(armFactoryPr(stub.root, 42, "green"), { action: "armed", head: HEAD });
    assert.ok(stub.log().includes(`--match-head-commit ${HEAD}`));
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("an already armed pull request is not sent a second merge request", () => {
  const stub = withStubs({
    state: { state: "OPEN", autoMergeRequest: { mergeMethod: "REBASE" } },
    reviews: [[approval()]],
  });
  try {
    assert.equal(armFactoryPr(stub.root, 42, "approval").action, "wait");
    assert.equal(stub.log().includes("gh pr merge"), false);
  } finally {
    stub.restore();
    stub.dispose();
  }
});

test("the trust bar holds checks, mergeability, ancestry, protected paths and policy", () => {
  const state = { state: "OPEN" as const, autoMergeRequest: null };
  const facts = {
    pr: pr(),
    reviews: [approval()],
    state,
    files: ["README.md"],
    mainIsAncestor: true,
    policy: "approval" as const,
  };
  assert.deepEqual(armMergeDecision(facts), { action: "arm" });
  assert.equal(
    armMergeDecision({
      ...facts,
      pr: pr({
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          workflowName: EXPECTED_CHECKS[0][0],
          name: EXPECTED_CHECKS[0][1],
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
      ],
    }),
    }).action,
    "wait",
  );
  assert.equal(armMergeDecision({ ...facts, pr: pr({ mergeStateStatus: "BLOCKED" }) }).action, "wait");
  assert.equal(armMergeDecision({ ...facts, mainIsAncestor: false }).action, "wait");
  assert.equal(armMergeDecision({ ...facts, files: [".sandcastle/main.mts"] }).action, "wait");
  assert.equal(
    armMergeDecision({ ...facts, pr: pr({ labels: [{ name: "device-evidence-pending" }] }) }).action,
    "wait",
  );
  assert.equal(armMergeDecision({ ...facts, reviews: [] }).action, "wait");
  assert.deepEqual(armMergeDecision({ ...facts, policy: "green", reviews: [] }), { action: "arm" });
  assert.equal(
    armMergeDecision({
      ...facts,
      state: { state: "MERGED", autoMergeRequest: null },
    }).action,
    "wait",
  );
});
