import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { REPO } from "./queue.mjs";

const Repository = z.object({ full_name: z.string() });
const Event = z.object({
  repository: Repository,
  ref: z.string().optional(),
  action: z.string().optional(),
  pull_request: z
    .object({
      user: z.object({ login: z.string() }),
      draft: z.boolean(),
      base: z.object({ ref: z.string() }),
      head: z.object({ repo: Repository.nullable() }),
    })
    .optional(),
  workflow_run: z.object({ head_branch: z.string().nullable() }).optional(),
});

export function relevantEvent(name: string, payload: unknown): boolean {
  const event = Event.parse(payload);
  if (event.repository.full_name.toLowerCase() !== REPO.toLowerCase())
    return false;
  switch (name) {
    case "workflow_dispatch":
      return true;
    case "push":
      return event.ref === "refs/heads/main";
    case "pull_request_target": {
      const pr = event.pull_request;
      return (
        pr !== undefined &&
        !pr.draft &&
        pr.user.login === "dependabot[bot]" &&
        pr.base.ref === "main" &&
        pr.head.repo?.full_name.toLowerCase() === REPO.toLowerCase() &&
        ["opened", "synchronize", "reopened", "ready_for_review"].includes(
          event.action ?? "",
        )
      );
    }
    case "workflow_run": {
      // Completed main runs carry no evidence beyond their push event, which
      // already wakes the watchdog; only Dependabot CI adds new exact-head state.
      const branch = event.workflow_run?.head_branch;
      return (
        event.action === "completed" &&
        branch?.startsWith("dependabot/") === true
      );
    }
    default:
      return false;
  }
}

const FactoryEvent = z.object({
  repository: Repository,
  action: z.string().optional(),
  label: z.object({ name: z.string() }).optional(),
  pull_request: z
    .object({
      merged: z.boolean(),
      head: z.object({ ref: z.string(), repo: Repository.nullable() }),
    })
    .optional(),
  workflow_run: z.object({ head_branch: z.string().nullable() }).optional(),
});

const FACTORY_BRANCH = /^sandcastle\/issue-\d+$/;

/**
 * What a GitHub event can change for the issue factory. `queue`: a ticket may
 * have become free to start, which matters to the next pass. `delivery`: a
 * factory pull request merged or its checks finished, which a running pass
 * acts on at once.
 */
export type FactoryEventKind = "queue" | "delivery";

/**
 * Sorts a GitHub event for the issue factory, or returns null when it changes
 * nothing the factory reads. An event is only a wake-up: the factory reads the
 * current state from GitHub afterwards, so nothing in the payload is trusted.
 */
export function factoryEventKind(
  name: string,
  payload: unknown,
): FactoryEventKind | null {
  const event = FactoryEvent.parse(payload);
  if (event.repository.full_name.toLowerCase() !== REPO.toLowerCase())
    return null;
  switch (name) {
    case "workflow_dispatch":
      return "queue";
    case "issues":
      return event.action === "labeled" && event.label?.name === "ready-for-agent"
        ? "queue"
        : null;
    case "pull_request_target": {
      const pr = event.pull_request;
      if (
        pr === undefined ||
        event.action !== "closed" ||
        !FACTORY_BRANCH.test(pr.head.ref) ||
        pr.head.repo?.full_name.toLowerCase() !== REPO.toLowerCase()
      )
        return null;
      // A merge has an issue to close; a request closed unmerged frees its ticket.
      return pr.merged ? "delivery" : "queue";
    }
    case "workflow_run":
      return event.action === "completed" &&
        FACTORY_BRANCH.test(event.workflow_run?.head_branch ?? "")
        ? "delivery"
        : null;
    default:
      return null;
  }
}

/** Queues an event file; `prefix` lets a consumer list one kind of event. */
export function enqueueEvent(
  directory: string,
  source: string,
  prefix = "",
): string {
  mkdirSync(directory, { recursive: true });
  const name = `${prefix}${randomUUID()}.json`;
  const temporary = join(directory, `${name}.tmp`);
  writeFileSync(
    temporary,
    `${JSON.stringify({ source, received: new Date().toISOString() })}\n`,
    { flag: "wx" },
  );
  renameSync(temporary, join(directory, name));
  return name;
}

export function pendingEvents(
  directory: string,
  prefix = "",
): readonly string[] {
  mkdirSync(directory, { recursive: true });
  return readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
}

export function acknowledgeEvents(
  directory: string,
  snapshot: readonly string[],
) {
  // Two consumers can acknowledge the same file; the second finds it gone.
  for (const name of snapshot) rmSync(join(directory, name), { force: true });
}
