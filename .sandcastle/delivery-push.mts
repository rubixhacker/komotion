/**
 * The git arguments for a factory delivery push. The interactive pre-push hook must stay active:
 * the factory's own gate already passed on this exact head, and the hook's diff and spotless checks
 * apply to deliveries like any other push. The stale-branch guard exempts `sandcastle/*` branches.
 */
export function deliveryPushArgs(branch: string): readonly string[] {
  return [
    "-c",
    "core.hooksPath=.githooks",
    "push",
    "origin",
    `${branch}:refs/heads/${branch}`,
  ];
}

/**
 * Push a delivered branch through the pre-push hook. The hook re-runs
 * spotlessCheck, which the gate already passed on the same content; under
 * concurrent Gradle load that re-run can fail transiently (two such failures
 * on 16 November, each green on the next attempt). A push that landed but
 * whose command errored is a success, so the remote head is read before every
 * attempt, and a genuine failure gets one more attempt before it is believed.
 */
export function pushDeliveredBranch(
  push: () => void,
  remoteHead: () => string,
  head: string,
  attempts = 2,
): void {
  for (let attempt = 1; ; attempt += 1) {
    if (remoteHead() === head) return;
    try {
      push();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
  }
}
