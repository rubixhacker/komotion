import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryPushArgs, pushDeliveredBranch } from "./delivery-push.mjs";

const head = "h".repeat(40);

test("a delivery push runs the interactive hook and carries no bypass", () => {
  const args = deliveryPushArgs("sandcastle/issue-2479");
  assert.deepEqual(args, [
    "-c",
    "core.hooksPath=.githooks",
    "push",
    "origin",
    "sandcastle/issue-2479:refs/heads/sandcastle/issue-2479",
  ]);
  assert.ok(!args.includes("--no-verify"));
});

test("a push that lands first time is not repeated", () => {
  let pushes = 0;
  let remote = "";
  pushDeliveredBranch(
    () => {
      pushes += 1;
      remote = head;
    },
    () => remote,
    head,
  );
  assert.equal(pushes, 1);
});

test("a transient hook failure gets one more attempt", () => {
  let pushes = 0;
  let remote = "";
  pushDeliveredBranch(
    () => {
      pushes += 1;
      if (pushes === 1) throw new Error("spotlessCheck failed");
      remote = head;
    },
    () => remote,
    head,
  );
  assert.equal(pushes, 2);
});

test("a push that landed but errored is a success, not a retry", () => {
  let pushes = 0;
  pushDeliveredBranch(
    () => {
      pushes += 1;
      throw new Error("connection reset after the ref updated");
    },
    () => head,
    head,
  );
  assert.equal(pushes, 0);
});

test("a persistent failure is thrown after the bounded attempts", () => {
  let pushes = 0;
  assert.throws(
    () =>
      pushDeliveredBranch(
        () => {
          pushes += 1;
          throw new Error("hook keeps failing");
        },
        () => "",
        head,
      ),
    /hook keeps failing/u,
  );
  assert.equal(pushes, 2);
});
