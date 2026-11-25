import {
  FEEDBACK_MARKER,
  type IssueTriageThresholds,
  type StateLabel,
  TRIAGE_COMMENT_MARKER,
  isStateLabel,
} from "./issue-triage-policy.mjs";

export { FEEDBACK_MARKER };

export interface TriageComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/** An owner's correction of a verdict this lane posted. */
export interface TriageCorrection {
  issueNumber: number;
  commentId: string;
  author: string;
  createdAt: string;
  /** The state role the owner says is correct. */
  verdict: StateLabel;
  /** The verdict this lane posted, when the comment it corrects was found. */
  previousVerdict: StateLabel | undefined;
  reason: string;
}

function parseMarker(line: string): { verdict: string; reason: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(FEEDBACK_MARKER)) return undefined;
  const rest = trimmed.slice(FEEDBACK_MARKER.length);
  const verdictMatch = rest.match(/verdict=([^\s]+)/i);
  const reasonMatch = rest.match(/reason="([^"]+)"|reason=([^\s]+)/i);
  return {
    verdict: verdictMatch?.[1] ?? "",
    reason: (reasonMatch?.[1] ?? reasonMatch?.[2] ?? "").trim(),
  };
}

function previousVerdict(comments: readonly TriageComment[], index: number): StateLabel | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const comment = comments[i];
    if (!comment?.body.includes(TRIAGE_COMMENT_MARKER)) continue;
    const match = comment.body.match(/Triage verdict: \*\*([\w-]+)\*\*/);
    const verdict = match?.[1];
    if (isStateLabel(verdict)) return verdict;
  }
  return undefined;
}

/**
 * Read owner corrections from issue comments. A correction is a comment whose
 * line starts with `/triage-feedback` and names a valid state role and a reason.
 * Comments that merely mention the marker inside prose are ignored.
 */
export function parseFeedback(
  comments: readonly TriageComment[],
  issueNumber: number,
): TriageCorrection[] {
  const corrections: TriageCorrection[] = [];
  comments.forEach((comment, index) => {
    const line = comment.body
      .split("\n")
      .find((candidate) => candidate.trimStart().startsWith(FEEDBACK_MARKER));
    if (!line) return;
    const marker = parseMarker(line);
    if (!marker || !isStateLabel(marker.verdict) || !marker.reason) return;
    corrections.push({
      issueNumber,
      commentId: comment.id,
      author: comment.author,
      createdAt: comment.createdAt,
      verdict: marker.verdict,
      previousVerdict: previousVerdict(comments, index),
      reason: marker.reason,
    });
  });
  return corrections;
}

/** Corrections that have not been recorded in the append-only feedback log. */
export function newCorrections(
  corrections: readonly TriageCorrection[],
  knownIds: ReadonlySet<string>,
): TriageCorrection[] {
  return corrections.filter((correction) => !knownIds.has(correction.commentId));
}

export interface FeedbackDigest {
  corrections: TriageCorrection[];
  /** How often each state role was corrected, keyed by the verdict it replaced. */
  counts: Partial<Record<StateLabel, number>>;
  excerpt: string;
}

/** Build the owner-feedback context shown to the model on every later pass. */
export function buildFeedbackDigest(
  corrections: readonly TriageCorrection[],
  limit = 20,
): FeedbackDigest {
  const counts: Partial<Record<StateLabel, number>> = {};
  for (const correction of corrections) {
    const verdict = correction.previousVerdict;
    if (verdict) counts[verdict] = (counts[verdict] ?? 0) + 1;
  }
  const recent = [...corrections]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  const lines = recent.map((correction) => {
    const from = correction.previousVerdict ?? "(unknown)";
    return `- #${correction.issueNumber}: ${from} -> ${correction.verdict} ("${correction.reason}")`;
  });
  return {
    corrections: [...corrections],
    counts,
    excerpt: lines.length > 0 ? `Owner feedback on past triage verdicts:\n${lines.join("\n")}` : "",
  };
}

export interface CalibrationOptions {
  /** Corrections of a verdict needed before its bar moves. */
  minCorrections: number;
  /** How much to raise the bar for each correction above that floor. */
  step: number;
  max: number;
}

export const defaultCalibration: CalibrationOptions = {
  minCorrections: 3,
  step: 0.03,
  max: 0.98,
};

/**
 * A verdict the owner corrects repeatedly gets a higher probability bar, so the
 * same mistake needs stronger evidence before the lane acts on it again. The bar
 * never drops below its configured baseline: a correction can only make the lane
 * more cautious, never more eager.
 */
export function calibrateThresholds(
  base: IssueTriageThresholds,
  digest: FeedbackDigest,
  options: CalibrationOptions = defaultCalibration,
): IssueTriageThresholds {
  const probability = { ...base.probability };
  for (const [verdict, count] of Object.entries(digest.counts)) {
    if (!isStateLabel(verdict) || count < options.minCorrections) continue;
    probability[verdict] = Math.max(
      probability[verdict],
      Math.min(
        options.max,
        probability[verdict] + options.step * (count - options.minCorrections + 1),
      ),
    );
  }
  return { probability, ownerGate: base.ownerGate };
}

/** The reply posted when a correction is accepted and applied. */
export function feedbackAcknowledgement(correction: TriageCorrection): string {
  const from = correction.previousVerdict ?? "the previous verdict";
  return [
    `> ${TRIAGE_COMMENT_MARKER}`,
    "",
    `Feedback recorded for #${correction.issueNumber}. The verdict changed from ${from} to **${correction.verdict}**.`,
    `Reason: ${correction.reason}`,
    "",
    "The next triage pass includes this correction as evidence and raises the bar for the corrected verdict.",
  ].join("\n");
}

/** Read the recorded feedback log without failing on a missing or partial file. */
export function readFeedbackLog(text: string): TriageCorrection[] {
  const records: TriageCorrection[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<TriageCorrection>;
      if (
        typeof value.commentId !== "string" ||
        typeof value.issueNumber !== "number" ||
        !isStateLabel(value.verdict) ||
        typeof value.reason !== "string"
      ) {
        continue;
      }
      records.push({
        issueNumber: value.issueNumber,
        commentId: value.commentId,
        author: value.author ?? "",
        createdAt: value.createdAt ?? "",
        verdict: value.verdict,
        previousVerdict: isStateLabel(value.previousVerdict) ? value.previousVerdict : undefined,
        reason: value.reason,
      });
    } catch {
      // A truncated final line from an interrupted write is not a correction.
    }
  }
  return records;
}
