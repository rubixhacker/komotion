import { fileURLToPath } from "node:url";
import { missingFlakyTests } from "./ci-flake.mjs";

/**
 * verifySandcastle guard against a stale flake-list entry. A test that was
 * deleted or stabilized must be removed from `FLAKY_TEST_CLASSES`, or its
 * failures keep being retried silently instead of reaching the repair path.
 */
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const missing = missingFlakyTests(repositoryRoot);
if (missing.length > 0) {
  console.error(
    `verifySandcastle: FLAKY_TEST_CLASSES names tests that no longer exist: ${missing.join(", ")}`,
  );
  process.exitCode = 1;
}
