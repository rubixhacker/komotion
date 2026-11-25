import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SANDBOX_CACHE_DIRS, sandboxCacheMounts } from "./sandbox-cache.mjs";

test("the cache mounts are writable directories at their own host paths", () => {
  const root = mkdtempSync(join(tmpdir(), "sandcastle-cache-"));
  const mounts = sandboxCacheMounts(root);
  assert.deepEqual(
    mounts.map((m) => m.hostPath),
    SANDBOX_CACHE_DIRS.map((dir) => resolve(root, dir)),
  );
  for (const mount of mounts) {
    assert.ok(statSync(mount.hostPath).isDirectory());
    assert.equal(mount.sandboxPath, mount.hostPath);
    assert.equal(mount.readonly, false);
  }
});

test("a second call reuses the same host directories", () => {
  const root = mkdtempSync(join(tmpdir(), "sandcastle-cache-"));
  assert.deepEqual(sandboxCacheMounts(root), sandboxCacheMounts(root));
});
