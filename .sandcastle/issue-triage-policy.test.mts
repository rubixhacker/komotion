import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubQDecision } from "./subq.mjs";
import {
  type IssueTriageThresholds,
  TRIAGE_COMMENT_MARKER,
  decideIssueVerdict,
  decideIssueWithConfirmation,
  defaultThresholds,
  formatTriageComment,
  issueContentFingerprint,
  issueTriageQuestions,
  issueTriageState,
  issueVerdictOf,
  localIssueDecision,
  safeVerdict,
  stateLabelsOf,
} from "./issue-triage-policy.mjs";

function decision(choice: string, probability: number, noul: number): SubQDecision {
  return {
    model: "subq-snap-preview",
    answers: {
      ownerGate: { type: "noul", noul },
      verdict: {
        type: "choice",
        choice,
        probabilities: { [choice]: probability },
        confidence: 1,
      },
    },
    usage: { input_tokens: 10, output_tokens: 0 },
  };
}

const thresholds: IssueTriageThresholds = defaultThresholds();

test("agentVerdictNeedsDecisiveMassAndNoHumanGate", () => {
  const verdict = issueVerdictOf(decision("ready-for-agent", 0.9, 0.1));
  assert.equal(decideIssueVerdict(verdict, thresholds), "ready-for-agent");
});

test("agentVerdictWithHumanGateIsIndeterminate", () => {
  const verdict = issueVerdictOf(decision("ready-for-agent", 0.9, 0.8));
  assert.equal(decideIssueVerdict(verdict, thresholds), "unclear");
});

test("humanVerdictNeedsDecisiveMassAndHumanGate", () => {
  const verdict = issueVerdictOf(decision("ready-for-human", 0.9, 0.9));
  assert.equal(decideIssueVerdict(verdict, thresholds), "ready-for-human");
});

test("subThresholdVerdictIsIndeterminate", () => {
  const verdict = issueVerdictOf(decision("ready-for-agent", 0.6, 0.1));
  assert.equal(decideIssueVerdict(verdict, thresholds), "unclear");
});

test("blockedNeedsOnlyProbabilityMass", () => {
  const verdict = issueVerdictOf(decision("blocked", 0.95, 0.7));
  assert.equal(decideIssueVerdict(verdict, thresholds), "blocked");
});

test("wontfixHasAHigherBar", () => {
  const verdict = issueVerdictOf(decision("wontfix", 0.85, 0.2));
  assert.equal(decideIssueVerdict(verdict, thresholds), "unclear");
  assert.equal(
    decideIssueVerdict(issueVerdictOf(decision("wontfix", 0.95, 0.2)), thresholds),
    "wontfix",
  );
});

test("unclearClassificationIsNeverActionable", () => {
  const verdict = issueVerdictOf(decision("unclear", 1, 0));
  assert.equal(decideIssueVerdict(verdict, thresholds), "unclear");
});

test("confirmationReproducingTheVerdictStands", () => {
  const first = issueVerdictOf(decision("ready-for-agent", 0.93, 0.1));
  const confirmation = issueVerdictOf(decision("ready-for-agent", 0.91, 0.2));
  assert.equal(decideIssueWithConfirmation(first, confirmation, thresholds), "ready-for-agent");
});

test("confirmationDisagreeingLeavesTheIssueIndeterminate", () => {
  const first = issueVerdictOf(decision("ready-for-agent", 0.93, 0.1));
  const confirmation = issueVerdictOf(decision("ready-for-human", 0.91, 0.9));
  assert.equal(decideIssueWithConfirmation(first, confirmation, thresholds), "unclear");
});

test("indeterminateFirstVerdictNeverAutoDecides", () => {
  const first = issueVerdictOf(decision("ready-for-agent", 0.5, 0.1));
  const confirmation = issueVerdictOf(decision("ready-for-agent", 0.99, 0.1));
  assert.equal(decideIssueWithConfirmation(first, confirmation, thresholds), "unclear");
});

test("indeterminateFallsBackToReadyForHuman", () => {
  assert.equal(safeVerdict("unclear"), "ready-for-human");
  assert.equal(safeVerdict("blocked"), "blocked");
});

test("theQuestionsAskAboutHumanGateAndVerdictOnly", () => {
  assert.deepEqual(Object.keys(issueTriageQuestions), ["ownerGate", "verdict"]);
  assert.equal(issueTriageQuestions.ownerGate?.type, "noul");
  assert.equal(issueTriageQuestions.verdict?.type, "choice");
});

const issue = {
  number: 42,
  title: "Add a setting",
  body: "Add a setting for X.",
  labels: ["needs-triage"],
};

test("conflictingStateLabelsAreLeftForTheOwner", () => {
  const result = localIssueDecision(
    { ...issue, labels: ["ready-for-agent", "ready-for-human"] },
    { openBlockers: [], owner: undefined, mergedCloser: undefined },
  );
  assert.equal(result?.verdict, "unchanged");
  assert.equal(result?.rule, "label-conflict");
});

test("anOwnedIssueIsLeftAlone", () => {
  const result = localIssueDecision(issue, {
    openBlockers: [],
    owner: "open pull request #7",
    mergedCloser: undefined,
  });
  assert.equal(result?.verdict, "unchanged");
  assert.equal(result?.rule, "owned");
});

test("aMergedClosingPrIsWontfixWithoutAModelCall", () => {
  const result = localIssueDecision(issue, {
    openBlockers: [],
    owner: undefined,
    mergedCloser: 12,
  });
  assert.equal(result?.verdict, "wontfix");
  assert.equal(result?.rule, "merged-closing-pr");
});

test("anOpenNativeBlockerIsBlocked", () => {
  const result = localIssueDecision(issue, {
    openBlockers: [{ number: 9, title: "Other work" }],
    owner: undefined,
    mergedCloser: undefined,
  });
  assert.equal(result?.verdict, "blocked");
  assert.match(result?.reason ?? "", /#9/);
});

test("anUnownedIssueWithNoEvidenceNeedsAModelCall", () => {
  const result = localIssueDecision(issue, {
    openBlockers: [],
    owner: undefined,
    mergedCloser: undefined,
  });
  assert.equal(result, undefined);
});

test("onlyTerminalStateLabelsAreRecognised", () => {
  assert.deepEqual(stateLabelsOf(["needs-triage", "ready-for-agent", "blocked"]), [
    "ready-for-agent",
    "blocked",
  ]);
});

test("theStatePayloadCarriesTheIssueEvidenceAndFeedback", () => {
  const state = issueTriageState(
    issue,
    { openBlockers: [{ number: 3, title: "Blocker" }], owner: "branch x", mergedCloser: 8 },
    "Owner feedback: none",
  );
  assert.match(state, /Issue #42: Add a setting/);
  assert.match(state, /#3 "Blocker"/);
  assert.match(state, /Merged closing pull request: 8/);
  assert.match(state, /Owner feedback: none/);
});

test("theFingerprintIgnoresStateLabelsAndThisLanesOwnWrites", () => {
  const base = {
    ...issue,
    comments: [{ body: "a reporter comment" }],
  };
  const afterWrite = {
    ...base,
    labels: ["ready-for-human"],
    comments: [
      ...base.comments,
      { body: `> ${TRIAGE_COMMENT_MARKER}\n\nTriage verdict: **ready-for-human**` },
      { body: '/triage-feedback wrong verdict=blocked reason="wrong"' },
    ],
  };
  assert.equal(issueContentFingerprint(afterWrite), issueContentFingerprint(base));
});

test("theFingerprintChangesWhenTheOwnerOrIssueContentChanges", () => {
  const base = { ...issue, comments: [] as { body: string }[] };
  assert.notEqual(
    issueContentFingerprint({ ...base, body: "Different body." }),
    issueContentFingerprint(base),
  );
  assert.notEqual(
    issueContentFingerprint({ ...base, comments: [{ body: "new owner evidence" }] }),
    issueContentFingerprint(base),
  );
});

test("everyPostedCommentCarriesTheMarkerAndInstructions", () => {
  const comment = formatTriageComment({
    issue,
    verdict: "ready-for-human",
    reason: "A product decision is open.",
    evidence: ["Labels: needs-triage"],
    indeterminate: false,
  });
  assert.ok(comment.startsWith(`> ${TRIAGE_COMMENT_MARKER}`));
  assert.match(comment, /Triage verdict: \*\*ready-for-human\*\*/);
  assert.match(comment, /\/triage-feedback wrong verdict=/);
  assert.match(comment, /Labels: needs-triage/);
});

test("anIndeterminateCommentSaysWhyItWasLeftForAHuman", () => {
  const comment = formatTriageComment({
    issue,
    verdict: "ready-for-human",
    reason: "The two calls disagreed.",
    evidence: [],
    indeterminate: true,
  });
  assert.match(comment, /not confident or its two calls disagreed/);
});
