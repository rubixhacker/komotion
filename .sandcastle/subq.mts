export interface SubQQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  /**
   * Noul and choice criteria are objects (outcome/option -> description).
   * Score criteria are an ordered array of level descriptions (2-10 levels).
   */
  criteria: Record<string, string | null> | Array<string | null>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type SubQAnswer = NoulAnswer | ChoiceAnswer;

export interface SubQDecision {
  model: string;
  answers: Record<string, SubQAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Probability of "yes" for a noul answer, or 0 when the answer is absent/wrong type. */
export function noulOf(answer: SubQAnswer | undefined): number {
  return answer?.type === "noul" ? answer.noul : 0;
}

/** The chosen option for a choice answer, or undefined when absent/wrong type. */
export function choiceOf(answer: SubQAnswer | undefined): string | undefined {
  return answer?.type === "choice" ? answer.choice : undefined;
}

/** Probability mass for `choice` in a choice answer, or 0 when absent. */
export function probabilityOf(answer: SubQAnswer | undefined, choice: string): number {
  return answer?.type === "choice" ? (answer.probabilities[choice] ?? 0) : 0;
}

export interface SubmissionState {
  id: number;
  name: string;
  brand: string | null;
  gtin: string;
  category: string | null;
  caffeineMg: number | null;
  volumeMl: number | null;
  source: string | null;
  existingProduct: string | null;
}

/**
 * Build the `state` payload for a SubQ decision request. The state is a
 * structured object describing the submission so the model can evaluate
 * plausibility (name, brand, GTIN, category, caffeine/volume ranges, and
 * whether an existing product already matches).
 */
export function submissionState(state: SubmissionState): string {
  const lines = [
    `Submission #${state.id}`,
    `Name: ${state.name}`,
    `Brand: ${state.brand ?? "(none)"}`,
    `GTIN: ${state.gtin}`,
    `Category: ${state.category ?? "other"}`,
    `Caffeine mg: ${state.caffeineMg ?? "(unknown)"}`,
    `Volume ml: ${state.volumeMl ?? "(unknown)"}`,
    `Source: ${state.source ?? "(unknown)"}`,
    `Existing product: ${state.existingProduct ?? "(none)"}`,
  ];
  return lines.join("\n");
}

/**
 * The default triage questions for a user submission, keyed by answer name. The
 * `legit` noul is a yes/no gate and `classification` selects one of four named
 * options. Its probability mass is the confidence signal the triage gates on;
 * a separate 0-5 "how confident are you" score is deliberately not asked
 * because SubQ spreads those answers close to uniform.
 */
export const triageQuestions: Record<string, SubQQuestion> = {
  legit: {
    type: "noul",
    instructions:
      "Is this a legitimate, real-world beverage product submission (not a test, joke, placeholder, or spam entry)?",
    criteria: {
      true: "A real beverage product with a plausible name, brand, GTIN, and caffeine/volume values.",
      false: "A test, joke, placeholder, nonsensical, or spam entry.",
    },
  },
  classification: {
    type: "choice",
    instructions: "Classify this user submission.",
    criteria: {
      legit: "A real beverage product worth keeping.",
      spam: "A test, joke, placeholder, or nonsensical entry.",
      duplicate: "Already present in the catalog as an existing product.",
      unclear: "Cannot be determined from the given data.",
    },
  },
};

export class SubQError extends Error {}

/**
 * Call the SubQ Snap Decisions API for a single submission. Returns the typed
 * decision. Throws SubQError on any non-2xx response or network failure.
 */
export async function decideSubmission(
  baseUrl: string,
  apiKey: string,
  state: string,
  questions: Record<string, SubQQuestion>,
): Promise<SubQDecision> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "subq-snap-preview",
        state,
        questions,
      }),
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new SubQError(`SubQ request failed: ${error.message}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new SubQError(`SubQ decision failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as SubQDecision;
}
