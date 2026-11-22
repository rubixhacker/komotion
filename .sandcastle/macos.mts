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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MountConfig } from "@ai-hero/sandcastle";
import { seatbelt } from "@ai-hero/sandcastle/sandboxes/seatbelt";

/** The real path behind a path xcrun and Xcode use for their caches. */
function macTempRoots(): string[] {
  const temp = realpathSync(process.env.TMPDIR ?? "/tmp");
  const cache = join(dirname(temp), "C");
  return [temp, ...(existsSync(cache) ? [cache] : [])];
}

/** The Xcode app bundle, or null without one. */
function xcodeApp(): string | null {
  const standard = "/Applications/Xcode.app";
  if (existsSync(join(standard, "Contents", "Developer"))) return standard;
  try {
    const developer = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
    return existsSync(developer) ? developer : null;
  } catch {
    return null;
  }
}

/** The `DEVELOPER_DIR` value the host's Xcode tools need, or null without Xcode. */
function xcodeDeveloperDir(): string | null {
  const app = xcodeApp();
  if (app === null) return null;
  const developer = join(app, "Contents", "Developer");
  return existsSync(developer) ? developer : null;
}

/** Java 21, the JDK the Gradle wrapper uses. */
function javaHome(): string | null {
  try {
    // The lookup prints "Unable to locate a Java Runtime" on stderr when no
    // JDK is registered with the system; capture it so it does not leak into
    // the lane output.
    return execFileSync("/usr/libexec/java_home", ["-v", "21"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // No JDK 21 registered with the system: Homebrew's openjdk@21 is the JDK 21.
  }
  const homebrew = "/opt/homebrew/opt/openjdk@21";
  return existsSync(join(homebrew, "bin", "java")) ? homebrew : null;
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
  return mounts;
}

/**
 * Sandbox env for the native host: the host's PATH with Java 21 first so
 * Gradle does not pick up an older JDK, the shared Gradle and Kotlin/Native
 * caches at their host paths, and DEVELOPER_DIR at the Xcode app.
 */
export function macEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const rewritten: Record<string, string> = { ...env };
  const java = javaHome();
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
  const developer = xcodeDeveloperDir();
  if (developer !== null) rewritten.DEVELOPER_DIR = developer;
  return rewritten;
}

/**
 * The factory's provider factory: sandcastle's Seatbelt provider with
 * identity mounts and the host toolchain.
 */
export function factorySandbox() {
  return seatbelt({ env: macEnv({}), mounts: macMounts() });
}
