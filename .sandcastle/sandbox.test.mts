import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import {
  createFactorySandbox,
  deniedSandboxEnv,
  prepareLocalInputsCommand,
} from "./sandbox.mjs";

test("secrets from the env file are blanked before the sandbox starts", () => {
  // The library injects `.sandcastle/.env` into every container. The factory
  // overrides those keys so no credential reaches a sandbox.
  const denied = deniedSandboxEnv([
    "GH_TOKEN",
    "SUBQ_API_KEY",
    "SANDCASTLE_MODEL",
    "SUPABASE_DB_URL",
    "MOBAI_TAILSCALE_KEY",
    "OLLAMA_API_KEY",
  ]);
  assert.equal(denied.GH_TOKEN, "");
  assert.equal(denied.SUBQ_API_KEY, "");
  assert.equal(denied.SUPABASE_DB_URL, "");
  assert.equal(denied.MOBAI_TAILSCALE_KEY, "");
  assert.equal(denied.OLLAMA_API_KEY, "");
  assert.equal(denied.SANDCASTLE_MODEL, undefined);
});

test("factory startup copies selected nested files when the base has no factory directory", async () => {
  // Given: an upstream commit without the factory, with local prompts and private files.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-copy-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    git(
      "-c",
      "user.name=Factory Test",
      "-c",
      "user.email=factory@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Base without factory",
    );
    mkdirSync(join(root, ".sandcastle"));
    writeFileSync(
      join(root, ".sandcastle/plan-prompt.md"),
      "Plan this repository",
    );
    mkdirSync(join(root, ".sandcastle/agent/bin"), { recursive: true });
    writeFileSync(join(root, ".sandcastle/agent/bin/gradle"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(root, ".sandcastle/agent/opencode.json"), "{}");
    writeFileSync(join(root, ".sandcastle/.env"), "PRIVATE=must-not-copy");
    mkdirSync(join(root, ".sandcastle/worktrees"));
    writeFileSync(
      join(root, ".sandcastle/worktrees/private.log"),
      "must-not-copy",
    );
    // When: the actual Sandcastle lifecycle prepares a fresh sandbox.
    const sandbox = await createFactorySandbox({
      cwd: root,
      branch: "factory-test",
      sandbox: noSandbox(),
      copyToWorktree: [".sandcastle/plan-prompt.md", ".sandcastle/agent"],
    });
    try {
      // A selected directory arrives whole, with its files still executable.
      assert.equal(
        readFileSync(join(sandbox.worktreePath, ".sandcastle/agent/opencode.json"), "utf8"),
        "{}",
      );
      assert.notEqual(
        statSync(join(sandbox.worktreePath, ".sandcastle/agent/bin/gradle")).mode & 0o111,
        0,
      );
      // Then: only the explicitly selected file exists in the new directory.
      assert.equal(
        readFileSync(
          join(sandbox.worktreePath, ".sandcastle/plan-prompt.md"),
          "utf8",
        ),
        "Plan this repository",
      );
      assert.equal(
        existsSync(join(sandbox.worktreePath, ".sandcastle/.env")),
        false,
      );
      assert.equal(
        existsSync(
          join(sandbox.worktreePath, ".sandcastle/worktrees/private.log"),
        ),
        false,
      );
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worktree setup stages gitignored build inputs before the first build", async () => {
  // Given: a checkout whose tracked script stages the three gitignored inputs from a host root.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-inputs-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, "scripts/ci"), { recursive: true });
    copyFileSync(
      join(import.meta.dirname, "..", "scripts/ci/prepare-local-inputs.sh"),
      join(root, "scripts/ci/prepare-local-inputs.sh"),
    );
    git("add", "scripts/ci/prepare-local-inputs.sh");
    git(
      "-c",
      "user.name=Factory Test",
      "-c",
      "user.email=factory@example.invalid",
      "commit",
      "-m",
      "Base with prepare-local-inputs",
    );
    writeFileSync(join(root, "local.properties"), "sdk.dir=/opt/android-sdk");
    mkdirSync(join(root, "iosApp/Configuration"), { recursive: true });
    writeFileSync(
      join(root, "iosApp/Configuration/Keys.xcconfig"),
      "PRODUCT_BUNDLE_IDENTIFIER=com.example",
    );
    mkdirSync(join(root, "androidApp"), { recursive: true });
    const googleServices = JSON.stringify({
      client: [
        {
          client_info: { mobilesdk_app_id: "1:123:android:abc" },
          android_client_info: {
            package_name: "com.hackedcube.caffconscious.debug",
          },
        },
      ],
    });
    writeFileSync(join(root, "androidApp/google-services.json"), googleServices);
    const command = prepareLocalInputsCommand(root);
    // The host runs its own checkout's copy by absolute path with the worktree
    // (the hook's cwd) as an explicit target; it never runs a relative script
    // that would resolve to the branch-controlled worktree copy.
    assert.ok(
      command.includes(resolve(root, "scripts/ci/prepare-local-inputs.sh")),
      "runs the trusted host checkout's copy by absolute path",
    );
    assert.ok(command.endsWith('"$(pwd)"'), "passes the worktree cwd as target");
    assert.ok(
      !command.includes("bash scripts/ci/prepare-local-inputs.sh"),
      "never runs the worktree's relative copy",
    );

    // When: the factory prepares a fresh sandbox worktree from that checkout.
    const sandbox = await createFactorySandbox({
      cwd: root,
      branch: "factory-inputs-test",
      sandbox: noSandbox(),
    });
    try {
      // Then: the worktree has all three inputs before the agent's first build.
      assert.equal(
        readFileSync(join(sandbox.worktreePath, "local.properties"), "utf8"),
        "sdk.dir=/opt/android-sdk",
      );
      assert.equal(
        readFileSync(
          join(sandbox.worktreePath, "iosApp/Configuration/Keys.xcconfig"),
          "utf8",
        ),
        "PRODUCT_BUNDLE_IDENTIFIER=com.example",
      );
      assert.equal(
        readFileSync(
          join(sandbox.worktreePath, "androidApp/google-services.json"),
          "utf8",
        ),
        googleServices,
      );
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worktree setup stages inputs from the host checkout, not a branch-controlled script", async () => {
  // Given: a host checkout with the trusted script and the three inputs, and a
  // branch whose worktree carries a script that must never run on the host.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-inputs-trust-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const commit = (message: string) =>
    git(
      "-c",
      "user.name=Factory Test",
      "-c",
      "user.email=factory@example.invalid",
      "commit",
      "-m",
      message,
    );
  try {
    git("init", "-b", "trusted");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, "scripts/ci"), { recursive: true });
    copyFileSync(
      join(import.meta.dirname, "..", "scripts/ci/prepare-local-inputs.sh"),
      join(root, "scripts/ci/prepare-local-inputs.sh"),
    );
    git("add", "scripts/ci/prepare-local-inputs.sh");
    commit("trusted host script");

    git("checkout", "-b", "branch-with-malicious-script");
    writeFileSync(
      join(root, "scripts/ci/prepare-local-inputs.sh"),
      [
        "#!/bin/bash",
        "set -euo pipefail",
        "printf MALICIOUS > branch-script-ran",
        // If this branch script ever runs on the host, it can read host files
        // through CAFF_LOCAL_INPUTS_DIR and copy them into the mounted worktree.
        'cp "$CAFF_LOCAL_INPUTS_DIR/host-secret" leaked-secret 2>/dev/null || true',
      ].join("\n"),
    );
    git("add", "scripts/ci/prepare-local-inputs.sh");
    commit("branch changes the setup script");

    // The host checkout goes back to the trusted ref. The inputs are gitignored
    // and live only on the host, so neither branch carries them.
    git("checkout", "trusted");
    writeFileSync(join(root, "local.properties"), "sdk.dir=/opt/android-sdk");
    mkdirSync(join(root, "iosApp/Configuration"), { recursive: true });
    writeFileSync(
      join(root, "iosApp/Configuration/Keys.xcconfig"),
      "PRODUCT_BUNDLE_IDENTIFIER=com.example",
    );
    mkdirSync(join(root, "androidApp"), { recursive: true });
    const googleServices = JSON.stringify({
      client: [
        {
          client_info: { mobilesdk_app_id: "1:123:android:abc" },
          android_client_info: {
            package_name: "com.hackedcube.caffconscious.debug",
          },
        },
      ],
    });
    writeFileSync(join(root, "androidApp/google-services.json"), googleServices);
    writeFileSync(join(root, "host-secret"), "must-not-leak");

    // When: the factory prepares a sandbox worktree from the branch.
    const sandbox = await createFactorySandbox({
      cwd: root,
      branch: "branch-with-malicious-script",
      sandbox: noSandbox(),
    });
    try {
      const wt = sandbox.worktreePath;
      // Then: the branch's script never ran on the host, so it left no marker
      // and could not copy a host-only file into the mounted worktree.
      assert.equal(existsSync(join(wt, "branch-script-ran")), false);
      assert.equal(existsSync(join(wt, "leaked-secret")), false);
      // The trusted host script staged all three inputs in the worktree.
      assert.equal(
        readFileSync(join(wt, "local.properties"), "utf8"),
        "sdk.dir=/opt/android-sdk",
      );
      assert.equal(
        readFileSync(join(wt, "iosApp/Configuration/Keys.xcconfig"), "utf8"),
        "PRODUCT_BUNDLE_IDENTIFIER=com.example",
      );
      assert.equal(
        readFileSync(join(wt, "androidApp/google-services.json"), "utf8"),
        googleServices,
      );
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manual worktree setup documents an explicit staging target", () => {
  // The script defaults TARGET_CHECKOUT to its own checkout. The automated host
  // hook passes the worktree explicitly, but the manual `git worktree add`
  // instruction must say so too: running the host's copy with no target stages
  // into the host and leaves the hand-made worktree empty (#2373).
  const doc = readFileSync(
    join(import.meta.dirname, "..", "docs/agents/parallel-worktrees.md"),
    "utf8",
  );
  const manual = doc
    .split("\n- ")
    .find((line) => line.includes("worktree you create by hand"));
  assert.ok(manual, "manual worktree add instruction is documented");
  assert.match(
    manual,
    /TARGET_CHECKOUT/,
    "manual instruction names the explicit target argument",
  );
  assert.match(
    manual,
    /prepare-local-inputs\.sh\s+\/path\/to\/worktree/,
    "manual instruction shows the worktree path passed as the target",
  );
});

test("factory sandboxes resolve Robolectric runtime jars from Google's Maven Central mirror", async () => {
  // Given: a provider that sets its own variables but not the Robolectric repository.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-env-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    git(
      "-c",
      "user.name=Factory Test",
      "-c",
      "user.email=factory@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Base",
    );
    // When: the factory prepares a sandbox from that provider.
    const sandbox = await createFactorySandbox({
      cwd: root,
      branch: "factory-env-test",
      sandbox: noSandbox({ env: { FACTORY_TEST_MARKER: "kept" } }),
    });
    try {
      // BSD printenv prints only its first argument; the shell's printf does
      // not, so the assertion is provider-neutral.
      const printed = await sandbox.exec(
        'printf "%s\\n" "$ROBOLECTRIC_DEPENDENCY_REPO_URL" "$FACTORY_TEST_MARKER"',
      );
      // Then: the sandbox sees the mirror, so Maven Central 429s cannot stall
      // Robolectric (#2003), and the provider's own variables survive.
      assert.equal(printed.exitCode, 0);
      assert.deepEqual(printed.stdout.trim().split("\n"), [
        "https://maven-central.storage-download.googleapis.com/maven2",
        "kept",
      ]);
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only a named, allowed credential may be handed to a sandbox", () => {
  const options = { branch: "sandcastle/issue-1", sandbox: noSandbox() };
  assert.throws(
    () => createFactorySandbox({ ...options, allowSecretEnv: ["GH_TOKEN"] }),
    /GH_TOKEN may never be passed/,
  );
  assert.throws(
    () =>
      createFactorySandbox({
        ...options,
        sandbox: noSandbox({ env: { OLLAMA_API_KEY: "a-key" } }),
      }),
    /Refusing to inject OLLAMA_API_KEY/,
  );
});

test("a fresh worktree has the repository's pre-push hook active without manual setup", async () => {
  // Given: a checkout whose committed hook fails so a push proves the hook ran.
  const root = mkdtempSync(join(tmpdir(), "sandcastle-hooks-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, ".githooks"), { recursive: true });
    writeFileSync(
      join(root, ".githooks/pre-push"),
      "#!/bin/sh\necho LOCAL_PUSH_HOOK_RAN >&2\nexit 1\n",
      { mode: 0o755 },
    );
    git("add", ".githooks/pre-push");
    git(
      "-c",
      "user.name=Factory Test",
      "-c",
      "user.email=factory@example.invalid",
      "commit",
      "-m",
      "Base with hooks",
    );
    // When: the factory prepares a fresh sandbox worktree from that checkout.
    const sandbox = await createFactorySandbox({
      cwd: root,
      branch: "factory-hooks-test",
      sandbox: noSandbox(),
    });
    try {
      // Then: git points at the tracked hooks without anyone running `git config` by hand.
      const configured = execFileSync(
        "git",
        ["-C", sandbox.worktreePath, "config", "--get", "core.hooksPath"],
        { encoding: "utf8" },
      ).trim();
      assert.equal(configured, ".githooks");

      // And a real push from that worktree is stopped by the active hook.
      const remote = mkdtempSync(join(tmpdir(), "sandcastle-hooks-remote-"));
      try {
        execFileSync("git", ["init", "--bare", "-q", remote], { stdio: "pipe" });
        const inWorktree = (...args: string[]) =>
          execFileSync("git", ["-C", sandbox.worktreePath, ...args], { stdio: "pipe" });
        inWorktree("remote", "add", "origin", remote);
        writeFileSync(join(sandbox.worktreePath, "work.txt"), "work\n");
        inWorktree("add", "work.txt");
        inWorktree(
          "-c",
          "user.name=Factory Test",
          "-c",
          "user.email=factory@example.invalid",
          "commit",
          "-m",
          "local work",
        );
        const push = spawnSync(
          "git",
          ["-C", sandbox.worktreePath, "push", "origin", "HEAD:refs/heads/main"],
          { encoding: "utf8" },
        );
        assert.notEqual(push.status, 0);
        assert.match(push.stderr + push.stdout, /LOCAL_PUSH_HOOK_RAN/u);
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
