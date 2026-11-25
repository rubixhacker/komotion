import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MergedPrRef,
  formatMergedPrs,
  mergedPrsForIssue,
  type MergedPrRef as MergedPrRefType,
} from "./merged-pr-context.mjs";

const pr = (overrides: Partial<MergedPrRefType>): MergedPrRefType =>
  MergedPrRef.parse({
    number: 1,
    title: "a change",
    body: "A change with no issue reference.",
    url: "https://github.com/rubixhacker/komotion/pull/1",
    state: "MERGED",
    mergedAt: "2026-11-16T10:00:00Z",
    closingIssuesReferences: [],
    ...overrides,
  });

// The motivating case: #2308 merged with a reference-style title while #2262
// stayed open, so GitHub recorded no closing reference for it.
const merged2308 = pr({
  number: 2308,
  title:
    "fix(ios): keep the Quick Entry fallback primary action visible (#2262)",
  url: "https://github.com/rubixhacker/komotion/pull/2308",
});

test("a merged PR that names the issue in its title is found without a closing reference", () => {
  const found = mergedPrsForIssue([merged2308], 2262);
  assert.deepEqual(
    found.map((candidate) => candidate.number),
    [2308],
  );
  const rendered = formatMergedPrs(found, 2262);
  assert.match(rendered, /PR #2308/);
  assert.match(rendered, /#2262/);
});

test("a merged PR that names the issue only in its body is found", () => {
  const found = mergedPrsForIssue(
    [
      pr({
        number: 2309,
        title: "restore the fallback action",
        body: "Reworks the path described in #2262.",
      }),
    ],
    2262,
  );
  assert.deepEqual(
    found.map((candidate) => candidate.number),
    [2309],
  );
});

test("a merged PR with a closing reference is still found", () => {
  const found = mergedPrsForIssue(
    [pr({ number: 42, closingIssuesReferences: [{ number: 2262 }] })],
    2262,
  );
  assert.deepEqual(
    found.map((candidate) => candidate.number),
    [42],
  );
});

test("PRs for other issues, including a longer number, are not reported", () => {
  const prs = [
    pr({
      number: 99,
      title: "unrelated fix (#99)",
      closingIssuesReferences: [{ number: 99 }],
    }),
    pr({ number: 100, title: "different ticket", body: "See #22620." }),
  ];
  assert.deepEqual(mergedPrsForIssue(prs, 2262), []);
});

test("an open PR is not reported as a landed change", () => {
  const open = pr({
    number: 2308,
    state: "OPEN",
    title: "fix(ios): fallback action (#2262)",
    closingIssuesReferences: [{ number: 2262 }],
  });
  assert.deepEqual(mergedPrsForIssue([open], 2262), []);
  assert.match(formatMergedPrs([], 2262), /No merged pull request references #2262/);
});
