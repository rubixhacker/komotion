import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueEvent, factoryEventKind, relevantEvent } from "./events.mjs";
import { FactoryError } from "./queue.mjs";

const eventFile = process.env.GITHUB_EVENT_PATH;
const eventName = process.env.GITHUB_EVENT_NAME;
if (!eventFile || !eventName)
  throw new FactoryError(
    "GITHUB_EVENT_PATH and GITHUB_EVENT_NAME are required",
  );
const lane = process.argv[2] ?? "dependabot";
const payload: unknown = JSON.parse(readFileSync(eventFile, "utf8"));
const logs = resolve(dirname(fileURLToPath(import.meta.url)), "logs");
if (lane === "factory") {
  const kind = factoryEventKind(eventName, payload);
  if (kind === null) {
    console.log(`Ignored unrelated ${eventName} event.`);
  } else {
    const id = enqueueEvent(
      resolve(logs, "factory-events"),
      eventName,
      `${kind}-`,
    );
    console.log(
      `Queued ${eventName} as ${id}; the issue factory will read current GitHub state.`,
    );
  }
} else if (lane === "triage") {
  const id = enqueueEvent(resolve(logs, "triage-events"), eventName, "triage-");
  console.log(
    `Queued ${eventName} as ${id}; the triage lane will read current GitHub state.`,
  );
} else if (lane !== "dependabot") {
  throw new FactoryError(`Unknown event lane: ${lane}`);
} else if (relevantEvent(eventName, payload)) {
  const id = enqueueEvent(resolve(logs, "dependabot-events"), eventName);
  console.log(
    `Queued ${eventName} as ${id}; the local watchdog will reconcile current GitHub state.`,
  );
} else {
  console.log(`Ignored unrelated ${eventName} event.`);
}
