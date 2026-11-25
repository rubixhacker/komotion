import { z } from "zod";
import { type GhJsonReader, fetchBlockedBy, openBlockers } from "./issue-blockers.mjs";
import type { TriageComment } from "./issue-triage-feedback.mjs";

/** The credentialed host command runner. No GitHub credential enters a sandbox. */
export type HostCommand = (program: string, args: readonly string[]) => string;

const GhComment = z.object({
  id: z.string(),
  body: z.string(),
  author: z.object({ login: z.string() }).nullable().optional(),
  createdAt: z.string(),
});

const GhIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string() })),
  updatedAt: z.string().optional(),
  url: z.string().optional(),
  comments: z.array(GhComment).default([]),
});

const GhPullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable().optional(),
  headRefName: z.string().optional(),
  closingIssuesReferences: z
    .array(z.object({ number: z.number().int().positive() }))
    .optional(),
});

export interface IssueForTriage {
  number: number;
  title: string;
  body: string;
  labels: string[];
  updatedAt: string;
  url: string;
  comments: TriageComment[];
}

export interface PullRequestForTriage {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  closingIssues: number[];
}

function readJson<T>(
  read: GhJsonReader,
  repo: string,
  args: readonly string[],
  schema: z.ZodType<T>,
): T {
  return schema.parse(JSON.parse(read([...args, "--repo", repo])));
}

function asComment(comment: z.infer<typeof GhComment>): TriageComment {
  return {
    id: comment.id,
    body: comment.body,
    author: comment.author?.login ?? "unknown",
    createdAt: comment.createdAt,
  };
}

function asIssue(issue: z.infer<typeof GhIssue>): IssueForTriage {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.map((label) => label.name),
    updatedAt: issue.updatedAt ?? "",
    url: issue.url ?? "",
    comments: issue.comments.map(asComment),
  };
}

function asPullRequest(pr: z.infer<typeof GhPullRequest>): PullRequestForTriage {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    headRefName: pr.headRefName ?? "",
    closingIssues: (pr.closingIssuesReferences ?? []).map((ref) => ref.number),
  };
}

/**
 * Fetch every open issue carrying either triage label. Two queries are used
 * rather than a comma-separated `--label` value so the OR semantics do not
 * depend on a `gh` CLI version; results are deduplicated by issue number.
 */
export function fetchTriagedIssues(
  read: GhJsonReader,
  repo: string,
  limit: number,
  labels: readonly string[] = ["needs-triage", "ready-for-human"],
): IssueForTriage[] {
  const fields = "number,title,body,labels,updatedAt,url,comments";
  const byNumber = new Map<number, IssueForTriage>();
  for (const label of labels) {
    const args = [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      label,
      "--limit",
      String(limit),
      "--json",
      fields,
    ];
    const issues = readJson(read, repo, args, z.array(GhIssue)).map(asIssue);
    for (const issue of issues) byNumber.set(issue.number, issue);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Fetch a title-only view of issues in every state. The retro uses this to
 * recognize a proposal it already filed, including an issue that a delivery
 * closed: the fingerprint changes when the proposal wording changes, but the
 * delivered work is still the same proposal.
 */
export function fetchIssuesByTitle(
  read: GhJsonReader,
  repo: string,
  limit = 200,
): { readonly number: number; readonly title: string }[] {
  return readJson(
    read,
    repo,
    ["issue", "list", "--state", "all", "--limit", String(limit), "--json", "number,title"],
    z.array(z.object({ number: z.number().int().positive(), title: z.string() })),
  );
}

/** Fetch open pull requests, which may already own an issue. */
export function fetchOpenPullRequests(read: GhJsonReader, repo: string): PullRequestForTriage[] {
  return readJson(
    read,
    repo,
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,body,headRefName,closingIssuesReferences",
    ],
    z.array(GhPullRequest),
  ).map(asPullRequest);
}

/** Fetch merged pull requests, which may have already delivered an issue. */
export function fetchMergedPullRequests(read: GhJsonReader, repo: string): PullRequestForTriage[] {
  return readJson(
    read,
    repo,
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      "200",
      "--json",
      "number,title,body,headRefName,closingIssuesReferences",
    ],
    z.array(GhPullRequest),
  ).map(asPullRequest);
}

/** Native "blocked by" edges, reduced to the open ones that still hold. */
export function fetchOpenIssueBlockers(
  read: GhJsonReader,
  repo: string,
  issueNumber: number,
): { number: number; title: string }[] {
  return openBlockers(fetchBlockedBy(read, repo, issueNumber)).map(({ number, title }) => ({
    number,
    title,
  }));
}

function mentionsIssue(text: string, issueNumber: number): boolean {
  return new RegExp(`(?:#|/issues/)${issueNumber}(?![0-9])`).test(text);
}

function branchNamesIssue(branch: string, issueNumber: number): boolean {
  return new RegExp(`(?:issue-|[-/])${issueNumber}(?:[-/]|$)`).test(branch);
}

/** The first PR, branch or worktree that already claims the issue, if any. */
export function ownedBy(
  issueNumber: number,
  pullRequests: readonly PullRequestForTriage[],
  branches: readonly string[],
): string | undefined {
  const pr = pullRequests.find(
    (candidate) =>
      candidate.closingIssues.includes(issueNumber) ||
      mentionsIssue(candidate.title, issueNumber) ||
      mentionsIssue(candidate.body, issueNumber) ||
      branchNamesIssue(candidate.headRefName, issueNumber),
  );
  if (pr) return `open pull request #${pr.number}`;
  const branch = branches.find((candidate) => branchNamesIssue(candidate, issueNumber));
  return branch ? `branch ${branch}` : undefined;
}

/** A merged PR with a closing reference delivers the issue. */
export function mergedCloser(
  issueNumber: number,
  pullRequests: readonly PullRequestForTriage[],
): number | undefined {
  return pullRequests.find((pr) => pr.closingIssues.includes(issueNumber))?.number;
}

/** Post the verdict comment on the issue. */
export function postTriageComment(
  run: HostCommand,
  repo: string,
  issueNumber: number,
  body: string,
): void {
  run("gh", [
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    repo,
    "--body",
    body,
  ]);
}

/** Swap the state role in one edit. `unchanged` makes no label change. */
export function applyVerdictLabel(
  run: HostCommand,
  repo: string,
  issueNumber: number,
  verdict: string,
  from: string | undefined,
): void {
  if (verdict === "unchanged") return;
  const args = ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", verdict];
  if (from && from !== verdict) args.push("--remove-label", from);
  run("gh", args);
}
