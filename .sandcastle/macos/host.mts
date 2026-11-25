import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { seatbelt } from "@ai-hero/sandcastle/sandboxes/seatbelt";

/**
 * The host adapter for the factory's sandbox provider.
 *
 * The factory runs the lanes in sandcastle's native `seatbelt()` provider: each
 * `exec` runs under `/usr/bin/sandbox-exec` with a deny-by-default SBPL profile,
 * the host's own Xcode and toolchain visible read-only, and the worktree,
 * caches and temp dirs writable. There is no image, no daemon and no Linux user
 * mapping to maintain, so the iOS toolchain is the one Xcode actually ships.
 *
 * Seatbelt cannot remap paths: a mount must appear at its own host path. The
 * old container's `/home/agent/workspace`, `/home/agent/.gradle` and PID-1
 * `sleep` therefore cannot exist here. Host paths are used instead, and the
 * tools that looked in the container home are pointed at the host cache with
 * env vars.
 */

export const IS_MAC = process.platform === "darwin";

export interface FactorySandboxMount {
  readonly hostPath: string;
  readonly sandboxPath: string;
  readonly readonly?: boolean;
}

export interface FactorySandboxOptions {
  readonly imageName?: string;
  readonly mounts: readonly FactorySandboxMount[];
  readonly env: Readonly<Record<string, string>>;
  readonly devices?: readonly string[];
  readonly [key: string]: unknown;
}

/** The real path behind a path xcrun and Xcode use for their caches. */
function macTempRoots(): string[] {
  // xcrun writes its command cache through confstr(_CS_DARWIN_USER_TEMP_DIR),
  // not TMPDIR. That is the real path behind /var/folders/.../T; its sibling
  // C holds the user cache. Both must be writable for Xcode to start.
  const temp = realpathSync(process.env.TMPDIR ?? "/tmp");
  const cache = join(dirname(temp), "C");
  return [temp, ...(existsSync(cache) ? [cache] : [])];
}

/**
 * The Xcode app bundle the factory's builds use.
 *
 * This Mac's `xcode-select -p` points at the Command Line Tools, so
 * `/usr/bin/xcodebuild` refuses to run; the Xcode app at
 * `/Applications/Xcode.app` is the developer directory the builds need.
 * Prefer it over the system answer, and fall back to `xcode-select -p` on a
 * host where the app lives somewhere else.
 */
function xcodeApp(): string | null {
  const standard = "/Applications/Xcode.app";
  if (existsSync(join(standard, "Contents", "Developer"))) return standard;
  try {
    const developer = execFileSync("xcode-select", ["-p"], {
      encoding: "utf8",
    }).trim();
    let dir = developer;
    for (let i = 0; i < 3; i += 1) {
      const parent = dirname(dir);
      if (parent === dir || parent === "/") break;
      dir = parent;
    }
    return existsSync(dir) ? dir : developer;
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

/** Java 21, the JDK Gradle and the iOS build use. */
function javaHome(): string | null {
  // Do not inherit the interactive shell's JAVA_HOME: Homebrew's default on
  // this Mac is 27, while Gradle and the iOS build are pinned to 21.
  try {
    return execFileSync("/usr/libexec/java_home", ["-v", "21"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // No JDK 21 registered with the system: this Mac has no passwordless
    // sudo to link one into /Library/Java, so Homebrew's openjdk@21 is the
    // JDK 21.
  }
  const homebrew = "/opt/homebrew/opt/openjdk@21";
  return existsSync(join(homebrew, "bin", "java")) ? homebrew : null;
}

/** Paths the sandbox must see at their own host location to use the native toolchain. */
export function macMounts(home = homedir()): FactorySandboxMount[] {
  const mounts: FactorySandboxMount[] = [];
  const add = (hostPath: string, readonly: boolean) => {
    if (!existsSync(hostPath)) return;
    const real = realpathSync(hostPath);
    mounts.push({ hostPath: real, sandboxPath: real, readonly });
  };
  add("/Applications/Xcode.app", true);
  const app = xcodeApp();
  if (app !== null && app !== "/Applications/Xcode.app") add(app, true);
  add("/Library/Developer", true);
  for (const root of macTempRoots()) add(root, false);
  for (const dir of [".gradle", ".konan", ".tokeneconomizer"]) {
    const path = join(home, dir);
    mkdirSync(path, { recursive: true });
    add(path, false);
  }
  // The Android SDK stays on the host too: Gradle resolves platforms from it,
  // and the factory preflight checks that the expected API is installed.
  add(join(home, "Library", "Android", "sdk"), false);
  return mounts;
}

/**
 * Container env rewritten for the native host.
 *
 * - PATH is the host's, with Java 21 first so Gradle does not pick up an older
 *   JDK.
 * - `OPENCODE_CONFIG_DIR` pointed into the container worktree. The agent dir
 *   is copied into every worktree, so a path relative to it works on both.
 * - The Gradle and Kotlin/Native caches live at their host paths.
 * - `DEVELOPER_DIR` points at the Xcode app, because this Mac's
 *   `xcode-select -p` points at the Command Line Tools and
 *   `/usr/bin/xcodebuild` refuses to run from it.
 */
export function macEnv(
  env: Readonly<Record<string, string>>,
  home = homedir(),
): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    rewritten[key] = value.startsWith("/home/agent/workspace/")
      ? value.slice("/home/agent/workspace/".length)
      : value;
  }
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
  rewritten.GRADLE_USER_HOME = rewritten.GRADLE_USER_HOME ?? join(home, ".gradle");
  rewritten.KONAN_DATA_DIR = rewritten.KONAN_DATA_DIR ?? join(home, ".konan");
  const developer = xcodeDeveloperDir();
  if (developer !== null) rewritten.DEVELOPER_DIR = developer;
  const sdk = join(home, "Library", "Android", "sdk");
  rewritten.ANDROID_HOME = rewritten.ANDROID_HOME ?? (existsSync(sdk) ? sdk : "");
  delete rewritten.SANDCASTLE_IMAGE;
  return rewritten;
}

/**
 * The factory's provider factory: sandcastle's Seatbelt provider with identity
 * mounts and a host toolchain.
 */
export function factorySandboxProvider(options: FactorySandboxOptions) {
  const home = homedir();
  const mounts = [
    ...options.mounts.map((mount) => ({
      hostPath: mount.hostPath,
      sandboxPath: mount.hostPath,
      readonly: mount.readonly === true,
    })),
    ...macMounts(home),
  ];
  return seatbelt({ env: macEnv(options.env, home), mounts });
}
