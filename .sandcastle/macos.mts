// The host adapter for the factory's Seatbelt sandbox provider.
//
// Each `exec` runs under /usr/bin/sandbox-exec with a deny-by-default
// profile: the host's toolchain visible read-only, the worktree, caches and
// temp dirs writable. There is no image to build or maintain.
//
// Two host-specific facts shape this file:
//
// - xcrun writes its command cache through confstr(_CS_DARWIN_USER_TEMP_DIR),
//   not TMPDIR. That is the real path behind /var/folders/.../T; its sibling
//   C holds the user cache. Both must be writable for git and the Xcode
//   tools to start inside the sandbox.
// - `xcode-select -p` on this Mac points at the Command Line Tools, so the
//   host's Xcode tools need DEVELOPER_DIR pointed at the Xcode app.

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { MountConfig } from "@ai-hero/sandcastle";
import { seatbelt } from "@ai-hero/sandcastle/sandboxes/seatbelt";
import {
  HEAVY_WORK_GATE_ENV,
  HEAVY_WORK_HELD_ENV,
  HEAVY_WORK_TIMEOUT_ENV,
  HEAVY_WORK_WAIT_ENV,
} from "./heavy-work.mts";
import { command } from "./process.mts";

export const HEAVY_WORK_STATE_ENV = "MACOS_HEAVY_WORK_STATE_DIR";
const EXPOSED_HEAVY_VARS = [
  HEAVY_WORK_HELD_ENV,
  HEAVY_WORK_GATE_ENV,
  HEAVY_WORK_STATE_ENV,
  HEAVY_WORK_WAIT_ENV,
  HEAVY_WORK_TIMEOUT_ENV,
] as const;

/** The real path behind a path xcrun and Xcode use for their caches. */
function macTempRoots(): string[] {
  const temp = realpathSync(process.env.TMPDIR ?? "/tmp");
  const cache = join(dirname(temp), "C");
  return [temp, ...(existsSync(cache) ? [cache] : [])];
}

let xcodeAppPromise: Promise<string | null> | undefined;

/** The Xcode app bundle, or null without one. */
function xcodeApp(): Promise<string | null> {
  xcodeAppPromise ??= (async () => {
    const standard = "/Applications/Xcode.app";
    if (existsSync(join(standard, "Contents", "Developer"))) return standard;
    try {
      const developer = (await command("xcode-select", ["-p"], {
        timeoutMs: 10_000,
        maxTailBytes: 4 * 1024,
      })).trim();
      return existsSync(developer) ? developer : null;
    } catch {
      return null;
    }
  })();
  return xcodeAppPromise;
}

/** The `DEVELOPER_DIR` value the host's Xcode tools need, or null without Xcode. */
async function xcodeDeveloperDir(): Promise<string | null> {
  const app = await xcodeApp();
  if (app === null) return null;
  const developer = join(app, "Contents", "Developer");
  return existsSync(developer) ? developer : null;
}

let javaHomePromise: Promise<string | null> | undefined;

/** Java 21, the JDK the Gradle wrapper uses. */
function javaHome(): Promise<string | null> {
  javaHomePromise ??= (async () => {
    try {
      // The lookup prints "Unable to locate a Java Runtime" on stderr when no
      // JDK is registered with the system; capture it so it does not leak into
      // the lane output.
      return (await command("/usr/libexec/java_home", ["-v", "21"], {
        timeoutMs: 10_000,
        maxTailBytes: 4 * 1024,
      })).trim();
    } catch {
      // No JDK 21 registered with the system: Homebrew's openjdk@21 is the JDK 21.
    }
    const homebrew = "/opt/homebrew/opt/openjdk@21";
    return existsSync(join(homebrew, "bin", "java")) ? homebrew : null;
  })();
  return javaHomePromise;
}

function heavyStateDir(home: string): string {
  const configured = process.env[HEAVY_WORK_STATE_ENV];
  return configured === undefined || configured === "" ? join(home, ".cache", "komotion-heavy-work") : resolve(configured);
}

/** Paths the sandbox must see at their own host location to use the native toolchain. */
export function macMounts(home = homedir()): MountConfig[] {
  const mounts: MountConfig[] = [];
  const add = (hostPath: string, readonly: boolean) => {
    if (!existsSync(hostPath)) return;
    const real = realpathSync(hostPath);
    mounts.push({ hostPath: real, sandboxPath: real, readonly });
  };
  add("/Applications/Xcode.app", true);
  add("/Library/Developer", true);
  for (const root of macTempRoots()) add(root, false);
  for (const dir of [".gradle", ".konan"]) {
    const path = join(home, dir);
    mkdirSync(path, { recursive: true });
    add(path, false);
  }

  // The heavy-work gate lives outside the worktree, and its lock state must
  // be writable from inside the sandbox.
  const gate = process.env[HEAVY_WORK_GATE_ENV];
  if (gate !== undefined && gate !== "") add(resolve(gate), true);
  const state = heavyStateDir(home);
  try {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    add(state, false);
  } catch {
    // A misconfigured state path is reported by the gate; it must not stop
    // unrelated sandbox work.
  }
  return mounts;
}

/**
 * Sandbox env for the native host: the host's PATH with Java 21 first so
 * Gradle does not pick up an older JDK, the shared Gradle and Kotlin/Native
 * caches at their host paths, and DEVELOPER_DIR at the Xcode app. Only the
 * heavy-work settings are copied from the host: no credentials cross into
 * the sandbox.
 */
export async function macEnv(
  env: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, string>> {
  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) rewritten[key] = value;
  }
  const java = await javaHome();
  rewritten.PATH = [
    ...(java === null ? [] : [`${java}/bin`]),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  rewritten.GRADLE_USER_HOME = rewritten.GRADLE_USER_HOME ?? join(homedir(), ".gradle");
  rewritten.KONAN_DATA_DIR = rewritten.KONAN_DATA_DIR ?? join(homedir(), ".konan");
  const developer = await xcodeDeveloperDir();
  if (developer !== null) rewritten.DEVELOPER_DIR = developer;

  const gate = rewritten[HEAVY_WORK_GATE_ENV];
  if (gate !== undefined && gate !== "" && existsSync(gate)) {
    rewritten[HEAVY_WORK_GATE_ENV] = realpathSync(gate);
  }
  rewritten[HEAVY_WORK_STATE_ENV] = rewritten[HEAVY_WORK_STATE_ENV] ?? heavyStateDir(homedir());
  return rewritten;
}

/**
 * The factory's provider factory: sandcastle's Seatbelt provider with
 * identity mounts and the host toolchain.
 */
export async function factorySandbox(extraMounts: MountConfig[] = []) {
  const exposed: Record<string, string> = {};
  for (const key of EXPOSED_HEAVY_VARS) {
    const value = process.env[key];
    if (value !== undefined && value !== "") exposed[key] = value;
  }
  return seatbelt({
    env: await macEnv(exposed),
    mounts: [...macMounts(), ...extraMounts],
  });
}
