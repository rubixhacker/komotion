import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caches every sandbox shares, mounted read-write at their host paths. A fresh
 * sandbox would otherwise download the whole Gradle distribution and dependency
 * set per ticket (6.4 GB observed on one author) before its first build starts;
 * the host keeps one cache, so each sandbox starts warm. Gradle locks its
 * dependency and build caches across processes, and Kotlin/Native its compiler
 * downloads, so parallel sandboxes share them safely. Seatbelt cannot remap
 * paths, so each mount appears at its own host path.
 */
export const SANDBOX_CACHE_DIRS = [".gradle", ".konan"] as const;

export function sandboxCacheMounts(hostCacheRoot: string) {
  return SANDBOX_CACHE_DIRS.map((dir) => {
    const hostPath = resolve(hostCacheRoot, dir);
    mkdirSync(hostPath, { recursive: true });
    return { hostPath, sandboxPath: hostPath, readonly: false };
  });
}
