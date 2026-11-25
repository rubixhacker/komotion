import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyVerdictLabel,
  fetchIssuesByTitle,
  fetchMergedPullRequests,
  fetchOpenPullRequests,
  fetchTriagedIssues,
  mergedCloser,
  ownedBy,
  postTriageComment,
} from "./issue-triage-github.mjs";

const repo = "org/repo";

const issueListPayload = JSON.stringify([
  {
    number: 7,
    title: "First issue",
    body: "Details",
    labels: [{ name: "needs-triage" }],
    updatedAt: "2026-11-20T00:00:00Z",
    url: "https://github.com/org/repo/issues/7",
    comments: [
      { id: "c1", body: "a comment", author: { login: "stewart" }, createdAt: "2026-11-20" },
    ],
  },
]);

test("bothTriageLabelsAreFetchedAndIssuesDeduplicated", () => {
  const commands: string[][] = [];
  const issues = fetchTriagedIssues(
    (args) => {
      commands.push([...args]);
      return issueListPayload;
    },
    repo,
    20,
  );
  assert.equal(issues.length, 1);
  assert.equal(commands.length, 2);
  assert.deepEqual(
    commands.map((args) => args[args.indexOf("--label") + 1]),
    ["needs-triage", "ready-for-human"],
  );
  assert.equal(issues[0]?.comments[0]?.author, "stewart");
});

test("aNullIssueBodyBecomesAnEmptyString", () => {
  const payload = JSON.stringify([
    { number: 8, title: "Second", body: null, labels: [], comments: [] },
  ]);
  const [issue] = fetchTriagedIssues(() => payload, repo, 20);
  assert.equal(issue?.body, "");
  assert.equal(issue?.url, "");
});

test("issues in every state are read by title for duplicate detection", () => {
  const commands: string[][] = [];
  const issues = fetchIssuesByTitle(
    (args) => {
      commands.push([...args]);
      return JSON.stringify([
        { number: 7, title: "[Factory retro] Delivered proposal" },
        { number: 9, title: "[Factory retro] Open proposal" },
      ]);
    },
    repo,
  );
  assert.deepEqual(
    issues.map((issue) => issue.number),
    [7, 9],
  );
  assert.ok(commands[0]?.includes("all"));
  assert.ok(commands[0]?.includes("number,title"));
});

test("openAndMergedPullRequestsAreReadFromGitHub", () => {
  const payload = JSON.stringify([
    {
      number: 12,
      title: "Fix #7",
      body: "closes #7",
      headRefName: "sandcastle/issue-7",
      closingIssuesReferences: [{ number: 7 }],
    },
  ]);
  const open = fetchOpenPullRequests((args) => {
    assert.ok(args.includes("open"));
    return payload;
  }, repo);
  const merged = fetchMergedPullRequests((args) => {
    assert.ok(args.includes("merged"));
    return payload;
  }, repo);
  assert.deepEqual(open[0]?.closingIssues, [7]);
  assert.equal(merged[0]?.headRefName, "sandcastle/issue-7");
});

test("aClosingPullRequestOwnsTheIssue", () => {
  const prs = [
    {
      number: 12,
      title: "A change",
      body: "",
      headRefName: "feature/x",
      closingIssues: [7],
    },
  ];
  assert.equal(ownedBy(7, prs, []), "open pull request #12");
  assert.equal(ownedBy(8, prs, []), undefined);
});

test("aBranchNamedAfterTheIssueOwnsIt", () => {
  assert.equal(ownedBy(7, [], ["main", "interactive/issue-7-label"]), "branch interactive/issue-7-label");
});

test("aPrMentioningTheIssueInItsTitleOwnsIt", () => {
  const prs = [
    { number: 9, title: "Work on #7", body: "", headRefName: "feature/x", closingIssues: [] },
  ];
  assert.equal(ownedBy(7, prs, []), "open pull request #9");
});

test("onlyAMergedClosingReferenceCountsAsDelivered", () => {
  const prs = [
    { number: 12, title: "#7", body: "", headRefName: "x", closingIssues: [7] },
    { number: 13, title: "#8", body: "", headRefName: "y", closingIssues: [] },
  ];
  assert.equal(mergedCloser(7, prs), 12);
  assert.equal(mergedCloser(8, prs), undefined);
});

test("theVerdictIsPostedAsAComment", () => {
  const calls: Array<{ program: string; args: readonly string[] }> = [];
  postTriageComment(
    (program, args) => {
      calls.push({ program, args });
      return "";
    },
    repo,
    7,
    "a comment",
  );
  assert.equal(calls[0]?.program, "gh");
  assert.deepEqual(calls[0]?.args, [
    "issue",
    "comment",
    "7",
    "--repo",
    repo,
    "--body",
    "a comment",
  ]);
});

test("theStateLabelIsSwappedInOneEdit", () => {
  const calls: string[][] = [];
  applyVerdictLabel(
    (_program, args) => {
      calls.push([...args]);
      return "";
    },
    repo,
    7,
    "ready-for-agent",
    "needs-triage",
  );
  assert.deepEqual(calls[0], [
    "issue",
    "edit",
    "7",
    "--repo",
    repo,
    "--add-label",
    "ready-for-agent",
    "--remove-label",
    "needs-triage",
  ]);
});

test("anUnchangedVerdictMakesNoGitHubWrite", () => {
  let calls = 0;
  applyVerdictLabel(
    () => {
      calls += 1;
      return "";
    },
    repo,
    7,
    "unchanged",
    "needs-triage",
  );
  assert.equal(calls, 0);
});
