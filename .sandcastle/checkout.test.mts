import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryCheckoutProblem } from "./checkout.mjs";

const main = "a".repeat(40);
const branch = "b".repeat(40);

test("a clean origin/main checkout may run", () => {
  assert.equal(
    factoryCheckoutProblem({
      dirty: "",
      head: main,
      originMain: main,
      dedicated: false,
    }),
    null,
  );
});

test("uncommitted factory files are refused even on the dedicated runtime", () => {
  const problem = factoryCheckoutProblem({
    dirty: " M .sandcastle/main.mts",
    head: main,
    originMain: main,
    dedicated: true,
  });
  assert.match(problem ?? "", /uncommitted changes/);
});

test("a feature branch is refused unless it is the dedicated runtime", () => {
  assert.match(
    factoryCheckoutProblem({
      dirty: "",
      head: branch,
      originMain: main,
      dedicated: false,
    }) ?? "",
    /dedicated runtime/,
  );
  assert.equal(
    factoryCheckoutProblem({
      dirty: "",
      head: branch,
      originMain: main,
      dedicated: true,
    }),
    null,
  );
});
