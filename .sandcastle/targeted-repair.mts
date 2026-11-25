/**
 * A generic CI repair that commits nothing found no source fault. Before
 * escalating, give one more agent the named evidence: the failing test names
 * and the contract/ADR files that govern them. The first repair already proved
 * the generic brief insufficient; repeating it verbatim wastes an agent.
 */

/** Test names a CI log names explicitly, in first-seen order. */
export function failingTestNames(log: string): string[] {
  const names = new Set<string>();
  const add = (match: RegExpMatchArray): void => {
    const name = match[1];
    if (name !== undefined) names.add(name);
  };
  for (const match of log.matchAll(/FAILED\s+([A-Z][\w]*\.[\w]+)/g)) add(match);
  for (const match of log.matchAll(/Test Case '-\[[\w.]+\s+([\w]+)\]/g)) add(match);
  for (const match of log.matchAll(/^(test[A-Z][\w]+)\b.*(?:FAILED|failed)/gm)) add(match);
  return [...names];
}

export interface TargetedEvidence {
  /** Failing test names extracted from the log. */
  readonly tests: readonly string[];
  /** Contract, ADR or test files the host found for those names. */
  readonly docs: readonly string[];
}

export function targetedRepairContext(failure: string, evidence: TargetedEvidence): string {
  const lines = [
    failure.trim(),
    "",
    "=== TARGETED SECOND ATTEMPT ===",
    "An earlier repair with only this failure log found no source fault. Before reaching the same conclusion, work from the named evidence below.",
  ];
  if (evidence.tests.length > 0) {
    lines.push(
      "",
      "Failing tests named by the check:",
      ...evidence.tests.slice(0, 12).map((name) => `- ${name}`),
    );
  }
  if (evidence.docs.length > 0) {
    lines.push(
      "",
      "Contracts, ADRs and test files that govern this area (read each one):",
      ...evidence.docs.slice(0, 12).map((path) => `- ${path}`),
    );
  }
  lines.push(
    "",
    "Decide against those contracts whether the assertion or the implementation is wrong. If a test asserts a stale field or shape, fix the test to the durable contract and add a regression that proves it; never change a correct implementation to satisfy an incorrect assertion. If the failure is a flake, a runner fault or unavailable infrastructure, change nothing and emit BLOCKED with that evidence.",
  );
  return lines.join("\n");
}
