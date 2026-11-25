// Bound launchd's open log files without replacing their inodes. launchd opens
// StandardOutPath/StandardErrorPath for append, so rewriting and truncating the
// existing file keeps its descriptor attached to the same inode.

import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readdirSync,
  realpathSync,
  readSync,
  rmSync,
  statSync,
  writeSync,
  type Dirent,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LOG_ARCHIVES = 5;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

export function logMaxBytes(): number {
  return positiveInteger(Number(process.env.SANDCASTLE_LOG_MAX_BYTES ?? DEFAULT_LOG_MAX_BYTES), "log max bytes");
}

export function logArchiveLimit(): number {
  return nonNegativeInteger(Number(process.env.SANDCASTLE_LOG_ARCHIVES ?? DEFAULT_LOG_ARCHIVES), "log archive limit");
}

export function laneLogPaths(root: string, lane: string): string[] {
  const logs = resolve(root, ".sandcastle/logs");
  return [
    resolve(logs, `launchd-${lane}.log`),
    resolve(logs, `launchd-${lane}.err.log`),
  ];
}

/**
 * Cap a file in place, retaining only its newest complete lines. The inode is
 * never replaced. A final unterminated line and a leading line fragment are
 * discarded rather than retaining a corrupt partial record.
 */
export function capLogInPlace(file: string, maxBytes: number): boolean {
  positiveInteger(maxBytes, "maxBytes");
  let fd: number;
  try {
    fd = openSync(file, "r+");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }

  try {
    const size = fstatSync(fd).size;
    if (size <= maxBytes) return false;
    const readLength = Math.min(size, maxBytes);
    const tail = Buffer.alloc(readLength);
    const bytesRead = readSync(fd, tail, 0, readLength, size - readLength);
    const readable = tail.subarray(0, bytesRead);

    let start = 0;
    if (size > readLength) {
      const newline = readable.indexOf(0x0a);
      start = newline < 0 ? readable.length : newline + 1;
    }
    let end = readable.length;
    if (end > start && readable[end - 1] !== 0x0a) {
      const newline = readable.lastIndexOf(0x0a, end - 2);
      end = newline < start ? start : newline + 1;
    }
    const retained = readable.subarray(start, end);
    if (retained.length > 0) writeSync(fd, retained, 0, retained.length, 0);
    ftruncateSync(fd, retained.length);
    return true;
  } finally {
    closeSync(fd);
  }
}

/** Keep only the newest N archive files for each active lane log. */
export function pruneLogArchives(root: string, lane: string, keep = DEFAULT_LOG_ARCHIVES): number {
  nonNegativeInteger(keep, "keep");
  const logs = resolve(root, ".sandcastle/logs");
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(logs, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  for (const active of [`launchd-${lane}.log`, `launchd-${lane}.err.log`]) {
    const archives = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${active}.`))
      .map((entry) => {
        const file = resolve(logs, entry.name);
        return { file, mtimeMs: statSync(file).mtimeMs, name: entry.name };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
    for (const archive of archives.slice(keep)) {
      rmSync(archive.file, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export function capLaneLogs(root: string, lane: string): void {
  const maxBytes = logMaxBytes();
  for (const file of laneLogPaths(root, lane)) capLogInPlace(file, maxBytes);
  pruneLogArchives(root, lane, logArchiveLimit());
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function cli(): void {
  const [action, ...args] = process.argv.slice(2);
  switch (action) {
    case "cap": {
      const root = optionValue(args, "--root");
      const lane = optionValue(args, "--lane");
      if (root === undefined || lane === undefined || lane === "") throw new Error("--root and --lane are required");
      capLaneLogs(root, lane);
      return;
    }
    case "cap-file": {
      const file = optionValue(args, "--path");
      if (file === undefined) throw new Error("--path is required");
      const max = optionValue(args, "--max-bytes");
      capLogInPlace(file, max === undefined ? logMaxBytes() : Number(max));
      return;
    }
    case "prune": {
      const root = optionValue(args, "--root");
      const lane = optionValue(args, "--lane");
      if (root === undefined || lane === undefined || lane === "") throw new Error("--root and --lane are required");
      console.log(pruneLogArchives(root, lane, logArchiveLimit()));
      return;
    }
    default:
      throw new Error("usage: logs.mts cap|cap-file|prune --root DIR [--lane LANE]");
  }
}

/** Node canonicalizes absolute entry paths on macOS, so compare real paths. */
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
    cli();
  } catch (error) {
    console.error(`sandcastle-logs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
