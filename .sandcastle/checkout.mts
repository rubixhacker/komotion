import { execFileSync } from "node:child_process";
import { FactoryError } from "./queue.mjs";

/**
 * Why this checkout must not run the factory, or null when it may.
 *
 * A shared checkout used to execute whatever was checked out in the interactive
 * tree, including a dirty feature branch. A dedicated runtime may be ahead of
 * origin/main (a fix branch) only when it is clean and explicitly marked.
 */
export function factoryCheckoutProblem(input: {
  readonly dirty: string;
  readonly head: string;
  readonly originMain: string;
  readonly dedicated: boolean;
}): string | null {
  if (input.dirty.trim() !== "") {
    return (
      "Refusing to run: .sandcastle has uncommitted changes. " +
        "The factory executes this checkout; commit or stash them first."
    );
  }
  if (!input.dedicated && input.head !== input.originMain) {
    return `Refusing to run from ${input.head.slice(0, 7)} instead of origin/main. The factory must use the dedicated runtime (SANDCASTLE_DEDICATED_RUNTIME=1).`;
  }
  return null;
}

export function assertFactoryCheckout(root: string): void {
  const git = (args: readonly string[]) =>
    execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
  const problem = factoryCheckoutProblem({
    dirty: git(["status", "--porcelain", "--", ".sandcastle"]),
    head: git(["rev-parse", "HEAD"]),
    originMain: git(["rev-parse", "origin/main"]),
    dedicated: process.env.SANDCASTLE_DEDICATED_RUNTIME === "1",
  });
  if (problem !== null) throw new FactoryError(problem);
}
