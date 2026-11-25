import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const standards = readFileSync(new URL("./CODING_STANDARDS.md", import.meta.url), "utf8");
const reviewPrompt = readFileSync(new URL("./review-prompt.md", import.meta.url), "utf8");

const SOURCE_DIAGNOSTIC = /source diagnostic/u;
const NOT_CHECKED = /not checked/u;
const LINUX_REFUSAL = /seatbelt\(\) needs macOS/u;
const NESTED_REFUSAL = /sandbox_apply: Operation not permitted|refuses to nest/u;
const CHANGED_SURFACE = /changes a command, a\s+hook step/u;
const RESTATES_BEHAVIOR = /restates that behavior/u;
const STALE_LINE = /stale line/u;
const DOC_DRIFT = /documentation\s+drift/u;
const LIVE_EVIDENCE = /LIVE-EVIDENCE REQUIRED/u;
const LIVE_DEPENDENCE = /CI run|deployed state/u;
const UNVERIFIED_FROM_CHANGE = /unverified from\s+the change/u;
const CLOSING_OBSERVATION = /observation that would close it/u;
const SPEC_PASS = /spec pass never implies that live\s+verification\s+happened/u;
const VERIFIABLE_TREATMENT = /criteria verifiable from the change/iu;

test("the factory coding standards carry the rule and both Seatbelt refusal cases", () => {
  assert.match(standards, SOURCE_DIAGNOSTIC);
  assert.match(standards, NOT_CHECKED);
  assert.match(standards, LINUX_REFUSAL);
  assert.match(standards, NESTED_REFUSAL);
});

test("the factory coding standards carry the stale-guidance rule", () => {
  assert.match(standards, CHANGED_SURFACE);
  assert.match(standards, RESTATES_BEHAVIOR);
  assert.match(standards, STALE_LINE);
  assert.match(standards, DOC_DRIFT);
});

test("a review of a sample classification change enforces the rule", () => {
  // A sample classification change: an iOS check exited 65 with only
  // "Test suite FAILED; Simulator unavailable" and no file, line or error.
  const sample = "iOS check failed (exit 65): Test suite FAILED; Simulator unavailable";
  assert.doesNotMatch(sample, /(?:error|warning):|[\w/]+\.swift:\d+:\d+/u);
  // The review prompt points the reviewer at the factory standards and tells it
  // to report this sample as not checked, not as a branch failure.
  assert.match(reviewPrompt, /CODING_STANDARDS\.md/u);
  assert.match(reviewPrompt, SOURCE_DIAGNOSTIC);
  assert.match(reviewPrompt, NOT_CHECKED);
  assert.match(reviewPrompt, LINUX_REFUSAL);
  assert.match(reviewPrompt, NESTED_REFUSAL);
});

test("a review of a sample stale hook guidance change enforces the rule", () => {
  // A branch removes the Swift preflight step from the pre-push hook. The stale
  // line still tells readers the hook runs it; the matching line describes the
  // new hook. The stale line is a blocking finding, the matching one passes.
  const staleGuidance = "CLAUDE.md: git push runs scripts/ci/swift-preflight.sh in the pre-push hook";
  const matchingGuidance = "CLAUDE.md: git push runs spotlessCheck and diff-check in the pre-push hook";
  assert.match(staleGuidance, /swift-preflight\.sh/u);
  assert.doesNotMatch(matchingGuidance, /swift-preflight\.sh/u);
  // The review prompt points the reviewer at the standards and tells it to
  // block stale restated guidance, not leave it as a non-blocking follow-up.
  assert.match(reviewPrompt, /CODING_STANDARDS\.md/u);
  assert.match(reviewPrompt, CHANGED_SURFACE);
  assert.match(reviewPrompt, RESTATES_BEHAVIOR);
  assert.match(reviewPrompt, STALE_LINE);
  assert.match(reviewPrompt, DOC_DRIFT);
});

test("the factory coding standards carry the live-evidence rule", () => {
  assert.match(standards, LIVE_EVIDENCE);
  assert.match(standards, LIVE_DEPENDENCE);
  assert.match(standards, UNVERIFIED_FROM_CHANGE);
  assert.match(standards, CLOSING_OBSERVATION);
  assert.match(standards, SPEC_PASS);
  assert.match(standards, VERIFIABLE_TREATMENT);
});

test("a review of a sample live-infrastructure criterion enforces the flag", () => {
  // A sample criterion a diff cannot close: the hosted check must be green at
  // the head and the deployed state must show the new offer. The other sample
  // is provable from the change and keeps its existing treatment.
  const liveCriterion =
    "Hosted CI run is green at the review head and the deployed state shows the new offer";
  const changeCriterion = "A TestBalloon test asserts the new parser behavior in the diff";
  assert.match(liveCriterion, LIVE_DEPENDENCE);
  assert.doesNotMatch(changeCriterion, LIVE_DEPENDENCE);
  // The review prompt points the reviewer at the standards, separates the two
  // kinds, and requires the flag, the unverified report and the closing
  // observation without changing how change-provable criteria are judged.
  assert.match(reviewPrompt, /CODING_STANDARDS\.md/u);
  assert.match(reviewPrompt, LIVE_EVIDENCE);
  assert.match(reviewPrompt, LIVE_DEPENDENCE);
  assert.match(reviewPrompt, UNVERIFIED_FROM_CHANGE);
  assert.match(reviewPrompt, CLOSING_OBSERVATION);
  assert.match(reviewPrompt, SPEC_PASS);
  assert.match(reviewPrompt, VERIFIABLE_TREATMENT);
  // Flagging stays a reporting requirement: pending evidence is still out of scope.
  assert.match(reviewPrompt, /out of scope/u);
});
