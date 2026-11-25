import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Tell a human that a lane needs them.
 *
 * The alert script appends to `.sandcastle/logs/factory-alerts.log` and shows a
 * desktop notification; a failed alert must not take the lane down with it.
 */
export function alertOperator(root: string, message: string): void {
  try {
    execFileSync("bash", [resolve(root, "scripts/sandcastle-alert.sh"), message], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(
      `could not alert (${message}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
