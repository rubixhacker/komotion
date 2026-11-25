import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAKY_TEST_CLASSES, flakyFailure, missingFlakyTests } from "./ci-flake.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("a known flaky test class is recognized in a failed log", () => {
  assert.match(
    flakyFailure("SpringTest > spring settles FAILED", ["SpringTest"]) ?? "",
    /SpringTest/u,
  );
  assert.match(
    flakyFailure("FreezeTest.freezeIsPure failed", ["FreezeTest"]) ?? "",
    /FreezeTest/u,
  );
});

test("a signature is scoped to the named test, not its whole class", () => {
  const signature = flakyFailure(
    "ActiveSippingNotificationOrderingTests.testSimulatorNotificationCenterPendingRequestSmoke() failed: " +
      'caught error: "Error Domain=UNErrorDomain Code=2003 Repository could not save notification request"',
    ["testSimulatorNotificationCenterPendingRequestSmoke"],
  );
  assert.match(signature ?? "", /testSimulatorNotificationCenterPendingRequestSmoke/u);

  // An ordering assertion in the same class is a real failure, not a flake.
  assert.equal(
    flakyFailure(
      "ActiveSippingNotificationOrderingTests.testPendingRequestOrderingIsStable failed",
      ["testSimulatorNotificationCenterPendingRequestSmoke"],
    ),
    null,
  );
});

test("a de-listed test is a real fault in a failed log", () => {
  assert.equal(
    flakyFailure("SpringTest > spring settles FAILED", ["FreezeTest"]),
    null,
  );
  // An unrelated failure is a real fault and carries no flake signature.
  assert.equal(flakyFailure("UnrelatedTest > an unrelated assertion FAILED"), null);
});

test("a transient host fault is recognized", () => {
  assert.equal(flakyFailure("Gradle daemon disappeared during the build"), "Gradle daemon disappeared");
  assert.equal(flakyFailure("java.lang.OutOfMemoryError: Java heap space"), "OutOfMemoryError");
});

test("a genuine compile error is not a flake", () => {
  assert.equal(
    flakyFailure("KomotionPlayerTest.kt:4: error: unresolved reference: foo"),
    null,
  );
  assert.equal(flakyFailure("e: file.kt:12:3 unresolved reference: foo"), null);
  assert.equal(flakyFailure(""), null);
});

test("the flake list names tests that still exist in this repository", () => {
  assert.deepEqual(missingFlakyTests(repositoryRoot), []);
  // An empty list is valid: Komotion has no confirmed flakes yet.
});

test("an entry whose test no longer exists is reported, preserving list order", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-flake-"));
  try {
    mkdirSync(join(root, "komotion-core", "src", "commonTest"), { recursive: true });
    writeFileSync(
      join(root, "komotion-core", "src", "commonTest", "SpringTest.kt"),
      "class SpringTest { fun springSettles() {} }\n",
    );
    // A mention in a doc is not a declaration.
    writeFileSync(join(root, "timings.md"), "GoneTests used to run here\n");

    assert.deepEqual(
      missingFlakyTests(root, ["GoneTests", "SpringTest", "springSettles"]),
      ["GoneTests"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the repository's flake list has no stale entry", () => {
  assert.deepEqual(missingFlakyTests(repositoryRoot, FLAKY_TEST_CLASSES), []);
});
