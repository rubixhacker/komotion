import { test } from "node:test";
import assert from "node:assert/strict";
import { gateFault } from "./gate-fault.mjs";

test("a gate that ran out of memory is the host's fault, not the branch's", () => {
  assert.equal(
    gateFault("Execution failed for task ':androidApp:lintAnalyzeDebug'.\n> Java heap space"),
    "the build ran out of memory",
  );
  assert.equal(
    gateFault("java.lang.OutOfMemoryError: Metaspace"),
    "the build ran out of memory",
  );
  assert.equal(gateFault("OpenJDK: Cannot allocate memory"), "the build ran out of memory");
});

test("a full disk and a dead daemon are the host's faults", () => {
  assert.equal(gateFault("java.io.IOException: No space left on device"), "the disk is full");
  assert.equal(
    gateFault("Gradle build daemon disappeared unexpectedly (it may have been killed or may have crashed)"),
    "the Gradle daemon died",
  );
});

test("an ordinary failure stays the branch's to repair", () => {
  assert.equal(gateFault("> Task :androidApp:lintDebug FAILED\nLint found 2 errors"), null);
  assert.equal(gateFault("e: Foo.kt:12:5 Unresolved reference: bar"), null);
});

test("Gradle's low-heap warning alone is not a fault: the build can still pass", () => {
  assert.equal(
    gateFault(
      "The Daemon will expire after the build after running out of JVM heap space.\n" +
        "The currently configured max heap space is '5.3 GiB' and the configured max metaspace is '2 GiB'.",
    ),
    null,
  );
});

test("a sandbox that cannot start a thread is out of processes, not out of memory", () => {
  const fault = "the sandbox ran out of processes";
  assert.equal(
    gateFault(
      '[1.774s][warning][os,thread] Failed to start thread "Unknown thread" - pthread_create failed (EAGAIN) for attributes: stacksize: 1024k',
    ),
    fault,
  );
  assert.equal(gateFault("# node[123455]: pthread_create: Resource temporarily unavailable"), fault);
  assert.equal(
    gateFault("java.lang.OutOfMemoryError: unable to create native thread: possibly out of memory or process/resource limits reached"),
    fault,
  );
});
