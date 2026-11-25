// CLI around the event marker primitives. It deliberately uses only Node
// builtins so the lane wrapper can consume markers before preflight installs
// dependencies, and so a dispatch runner needs no npm install just to enqueue.

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_EVENT_EXPIRY_SECONDS = 24 * 60 * 60;

export interface EventSnapshot {
  readonly prefix: string;
  readonly names: readonly string[];
}

function markerName(prefix: string): string {
  return `${prefix}${randomUUID()}.json`;
}

function atomicWrite(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The temporary file was already renamed.
    }
    throw error;
  }
}

/** Publish one complete marker by renaming it into the watched directory. */
export function publishMarker(directory: string, source = "cli", prefix = ""): string {
  mkdirSync(directory, { recursive: true });
  const name = markerName(prefix);
  atomicWrite(join(directory, name), `${JSON.stringify({ source, received: new Date().toISOString() })}\n`);
  return name;
}

/** List pending markers, oldest name first, without modifying the directory. */
export function pendingMarkers(directory: string, prefix = ""): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json") && !name.endsWith(".tmp"))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Remove only the exact names captured by a snapshot. */
export function acknowledgeMarkers(directory: string, names: readonly string[]): number {
  let removed = 0;
  for (const name of names) {
    if (name.includes("/") || name.includes("..") || !name.endsWith(".json")) {
      throw new Error(`invalid marker name ${name}`);
    }
    try {
      rmSync(join(directory, name), { force: true });
      removed += 1;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return removed;
}

/** Prune markers older than SANDCASTLE_EVENT_EXPIRY_SECONDS (0 disables it). */
export function expireMarkers(
  directory: string,
  prefix = "",
  options: { readonly expirySeconds?: number; readonly now?: number } = {},
): number {
  const configured = options.expirySeconds ?? process.env.SANDCASTLE_EVENT_EXPIRY_SECONDS;
  const seconds = configured === undefined ? DEFAULT_EVENT_EXPIRY_SECONDS : Number(configured);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new RangeError("event expiry seconds must be a non-negative integer");
  }
  if (seconds === 0) return 0;
  const now = options.now ?? Date.now();
  let removed = 0;
  for (const name of pendingMarkers(directory, prefix)) {
    try {
      if (now - statSync(join(directory, name)).mtimeMs > seconds * 1000) {
        rmSync(join(directory, name), { force: true });
        removed += 1;
      }
    } catch {
      // Another consumer acknowledged the marker first.
    }
  }
  return removed;
}

export function writeSnapshot(file: string, snapshot: EventSnapshot): void {
  atomicWrite(resolve(file), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function readSnapshot(file: string): EventSnapshot {
  const value = JSON.parse(readFileSync(file, "utf8")) as EventSnapshot;
  if (typeof value.prefix !== "string" || !Array.isArray(value.names) ||
      value.names.some((name) => typeof name !== "string" || name.includes("/") || name.includes(".."))) {
    throw new Error("invalid event snapshot");
  }
  return value;
}

/** Coalesce a consumed snapshot into one fresh trigger. */
export function requeueSnapshot(directory: string, snapshot: EventSnapshot): string | null {
  if (snapshot.names.length === 0) return null;
  return publishMarker(directory, `requeue:${snapshot.names.length}`, snapshot.prefix);
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return resolve(entry) === modulePath;
  }
}

if (isEntryPoint()) {
  try {
    const [action, ...args] = process.argv.slice(2);
    const directory = optionValue(args, "--directory");
    if (directory === undefined) throw new Error("--directory is required");
    const prefix = optionValue(args, "--prefix") ?? "";
    const snapshotFile = optionValue(args, "--snapshot");
    switch (action) {
      case "publish":
        console.log(publishMarker(directory, optionValue(args, "--source") ?? "cli", prefix));
        break;
      case "snapshot": {
        if (snapshotFile === undefined) throw new Error("--snapshot is required");
        writeSnapshot(snapshotFile, { prefix, names: pendingMarkers(directory, prefix) });
        break;
      }
      case "ack": {
        if (snapshotFile === undefined) throw new Error("--snapshot is required");
        console.log(acknowledgeMarkers(directory, readSnapshot(snapshotFile).names));
        break;
      }
      case "pending":
        console.log(pendingMarkers(directory, prefix).length);
        break;
      case "requeue": {
        if (snapshotFile === undefined) throw new Error("--snapshot is required");
        console.log(requeueSnapshot(directory, readSnapshot(snapshotFile)) ?? "");
        break;
      }
      case "expire":
        console.log(expireMarkers(directory, prefix));
        break;
      default:
        throw new Error("usage: events-cli.mts publish|snapshot|ack|pending|requeue|expire --directory DIR");
    }
  } catch (error) {
    console.error(`sandcastle-events: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
