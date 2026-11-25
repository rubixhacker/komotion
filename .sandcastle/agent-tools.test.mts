import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaOf, describe, isDeclaration, parseHits } from "./agent/cli/find-symbol.mts";
import { gradle, refusal, summarize, type BuildResult } from "./agent/cli/gradle.mts";
import { coordinatesOf, entriesFor, excerpt, sourcesUrl } from "./agent/cli/lib-source.mts";

/** A git repository with a `gradlew`, and a place for the tool's state. */
async function repository(run: (directory: string, state: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "agent-tools-"));
  const state = mkdtempSync(join(tmpdir(), "agent-tools-state-"));
  const git = (...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: directory });
  };
  try {
    writeFileSync(join(directory, "gradlew"), "#!/bin/sh\n");
    writeFileSync(join(directory, "Chart.kt"), "val a = 1\n");
    git("init", "-q");
    // The host's global git config may force signed commits; the fixture
    // sets its own signing policy so the check passes on any host.
    git("config", "commit.gpgsign", "false");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    await run(directory, state);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
}

function builds(results: readonly Omit<BuildResult, "seconds">[]) {
  const ran: string[][] = [];
  return {
    ran,
    run: async (_directory: string, words: readonly string[]): Promise<BuildResult> => {
      const result = results[ran.length];
      if (result === undefined) throw new Error("the build ran more often than expected");
      ran.push([...words]);
      return { ...result, seconds: 3 };
    },
  };
}

const FAILED_LOG = [
  "> Task :shared:compileKotlin",
  "> Task :androidApp:compileDebugKotlin FAILED",
  "e: file:///home/agent/workspace/androidApp/src/main/kotlin/Chart.kt:5:9 Unresolved reference 'label'.",
  "FAILURE: Build failed with an exception.",
  "* What went wrong:",
  "Execution failed for task ':androidApp:compileDebugKotlin'.",
  "BUILD FAILED in 41s",
].join("\n");

test("the same command on unchanged files is answered from the earlier run, not built again", async () => {
  await repository(async (directory, state) => {
    const build = builds([{ exitCode: 1, timedOut: false, log: FAILED_LOG }, { exitCode: 0, timedOut: false, log: "BUILD SUCCESSFUL in 9s" }]);
    const options = { directory, stateDirectory: state, run: build.run };

    const first = await gradle([":androidApp:compileDebugKotlin"], options);
    assert.equal(first.exitCode, 1);
    assert.match(first.text, /FAILED \(exit 1\)/);
    assert.match(first.text, /Unresolved reference 'label'/);

    const again = await gradle(["./gradlew", ":androidApp:compileDebugKotlin", "--no-daemon"], options);
    assert.equal(build.ran.length, 1);
    assert.match(again.text, /NOT RUN AGAIN/);
    assert.match(again.text, /Unresolved reference 'label'/);

    // An edit, tracked or new, is a different tree: the build runs.
    writeFileSync(join(directory, "Chart.kt"), "val label = 1\n");
    const fixed = await gradle([":androidApp:compileDebugKotlin"], options);
    assert.equal(build.ran.length, 2);
    assert.equal(fixed.exitCode, 0);
    assert.match(fixed.text, /PASSED/);
    assert.doesNotMatch(fixed.text, /NOT RUN AGAIN/);
  });
});

test("--rerun repeats a build the machine failed, and formatting is never reused", async () => {
  await repository(async (directory, state) => {
    const oom = { exitCode: 1, timedOut: false, log: "> Java heap space\nBUILD FAILED in 4m" };
    const pass = { exitCode: 0, timedOut: false, log: "BUILD SUCCESSFUL in 9s" };
    const build = builds([oom, pass, pass, pass]);
    const options = { directory, stateDirectory: state, run: build.run };
    await gradle(["qualityGate"], options);
    assert.equal((await gradle(["qualityGate", "--rerun"], options)).exitCode, 0);
    assert.deepEqual(build.ran[1], ["qualityGate"]);
    await gradle(["spotlessApply"], options);
    await gradle(["spotlessApply"], options);
    assert.equal(build.ran.length, 4);
  });
});

test("a build stopped for time names its last task and is not remembered as a result", async () => {
  await repository(async (directory, state) => {
    const hung = { exitCode: 137, timedOut: true, log: "> Task :a:compile\n> Task :androidApp:testDebugUnitTest\n" };
    const build = builds([hung, hung]);
    const options = { directory, stateDirectory: state, run: build.run };
    const first = await gradle(["qualityGate"], options);
    assert.equal(first.exitCode, 124);
    assert.match(first.text, /TIMED OUT/);
    assert.match(first.text, /Last task started: > Task :androidApp:testDebugUnitTest/);
    await gradle(["qualityGate"], options);
    assert.equal(build.ran.length, 2);
  });
});

test("arguments that hide findings, leave a process behind or carry shell syntax are refused", async () => {
  assert.match(refusal([]) ?? "", /at least one task/);
  assert.match(refusal(["qualityGate", "-x", "detekt"]) ?? "", /hides its findings/);
  assert.match(refusal(["detektBaseline"]) ?? "", /baseline/);
  assert.match(refusal([":androidApp:updateLintBaseline"]) ?? "", /baseline/);
  assert.match(refusal(["test", "--continuous"]) ?? "", /foreground/);
  assert.match(refusal(["test", "&&", "rm"]) ?? "", /shell syntax/);
  assert.match(refusal(["test", "$(id)"]) ?? "", /shell syntax/);
  assert.equal(refusal([":androidApp:testDebugUnitTest", "--tests", "*Today*"]), null);
  await repository(async (directory, state) => {
    const build = builds([]);
    const refused = await gradle(["qualityGate", "-x", "lintDebug"], { directory, stateDirectory: state, run: build.run });
    assert.equal(refused.exitCode, 2);
    assert.equal(build.ran.length, 0);
  });
});

test("a build log is cut down to what failed", () => {
  const log = [
    ...Array.from({ length: 400 }, (_, index) => `> Task :shared:leaf${index}:compileKotlin UP-TO-DATE`),
    "> Task :shared:feature:today:internal:testAndroidHostTest FAILED",
    "DailyTotalsPresenterTest > a day with no entries shows zero FAILED",
    "    AssertionError: Expected <0 mg> but was <null>",
    "/home/agent/workspace/androidApp/src/main/kotlin/ui/TodayScreen.kt:212:29: Raw spacing literal 12.dp [RawComposeSpacingLiteral]",
    "BUILD FAILED in 4m 12s",
  ].join("\n");
  const summary = summarize(log);
  assert.ok(summary.length < 900);
  assert.match(summary, /testAndroidHostTest FAILED/);
  assert.match(summary, /Expected <0 mg> but was <null>/);
  assert.match(summary, /RawComposeSpacingLiteral/);
  assert.doesNotMatch(summary, /UP-TO-DATE/);
});

test("a name's declarations are told from its uses, and Swift call sites come first", () => {
  assert.equal(isDeclaration("fun localizedFavoriteServingText(serving: Serving): String {", "localizedFavoriteServingText"), true);
  assert.equal(isDeclaration("data class Chart(val points: List<Point>)", "Chart"), true);
  assert.equal(isDeclaration("func accessiblePointText(metric: Metric) -> String {", "accessiblePointText"), true);
  assert.equal(isDeclaration("val text = localizedFavoriteServingText(serving)", "localizedFavoriteServingText"), false);
  assert.equal(isDeclaration("class ChartPresenter", "Chart"), false);

  assert.equal(areaOf("shared/feature/today/public/src/commonMain/kotlin/a/Chart.kt"), "shared/feature/today/public");
  assert.equal(areaOf("iosApp/CaffConsciousTests/ChartTests.swift"), "iosApp/CaffConsciousTests (tests)");
  assert.equal(areaOf("androidApp/src/test/kotlin/a/ChartTest.kt"), "androidApp (tests)");

  const hits = parseHits(
    [
      "shared/feature/today/public/src/commonMain/kotlin/a/Copy.kt:12:fun favoriteText(volumeMl: Double?): String =",
      "androidApp/src/main/kotlin/a/Screen.kt:40:    Text(favoriteText(serving.volumeMl))",
      "iosApp/CaffConsciousTests/CopyTests.swift:27:        let text = favoriteText(volumeMl: 1_250)",
    ].join("\n"),
  );
  const report = describe("favoriteText", hits);
  assert.match(report, /^favoriteText: 1 declaration\(s\), 2 use\(s\) in 2 file\(s\)\./);
  assert.ok(report.indexOf("iosApp/CaffConsciousTests (tests)") < report.indexOf("androidApp: 1 use"));
  assert.match(describe("Missing", []), /No source file mentions/);
});

test("a library class is found by simple or full name, with sources before bytecode", () => {
  const index = [
    "/c/files-2.1/dev.icerock.moko/resources/0.27.1/ab12/resources-0.27.1-sources.jar\tcommonMain/dev/icerock/moko/resources/desc/StringDesc.kt",
    "/c/files-2.1/dev.icerock.moko/resources-android/0.27.1/cd34/resources-android-0.27.1.jar\tdev/icerock/moko/resources/desc/StringDesc.class",
    "/c/files-2.1/dev.icerock.moko/resources-android/0.27.1/cd34/resources-android-0.27.1.jar\tdev/icerock/moko/resources/desc/StringDescKt.class",
    "/c/files-2.1/org.example/other/1.0/ef56/other-1.0.jar\torg/example/MyStringDesc.class",
  ];
  const simple = entriesFor(index, "StringDesc");
  assert.equal(simple.sources.length, 1);
  assert.equal(simple.classes.length, 1);
  assert.equal(entriesFor(index, "dev.icerock.moko.resources.desc.StringDesc").classes.length, 1);
  assert.equal(entriesFor(index, "org.example.StringDesc").classes.length, 0);

  const at = coordinatesOf("/home/agent/.gradle/caches/modules-2/files-2.1/dev.icerock.moko/resources-android/0.27.1/cd34/resources-android-0.27.1.jar");
  assert.deepEqual(at, { group: "dev.icerock.moko", artifact: "resources-android", version: "0.27.1" });
  assert.equal(
    at && sourcesUrl("https://repo.example/maven2", at),
    "https://repo.example/maven2/dev/icerock/moko/resources-android/0.27.1/resources-android-0.27.1-sources.jar",
  );
  assert.equal(coordinatesOf("/tmp/elsewhere/a.jar"), null);
});

test("a long source file is shown as an outline, and a member as its own lines", () => {
  const body = Array.from({ length: 300 }, (_, index) => `    // line ${index}`);
  const source = ["package a", "", "class Formatter {", ...body, "    fun localized(context: Context): String = TODO()", "}"].join("\n");
  const whole = excerpt(source, null);
  assert.match(whole, /declarations only/);
  assert.match(whole, /class Formatter \{/);
  assert.match(whole, /fun localized/);
  assert.doesNotMatch(whole, /line 150/);
  const member = excerpt(source, "localized");
  assert.match(member, /fun localized\(context: Context\)/);
  assert.doesNotMatch(member, /line 10\b/);
  assert.match(excerpt("class A {\n  val x = 1\n}", null), /val x = 1/);
});

test("the sandbox denies the commands the tools replace, and nothing else by default", () => {
  const config = JSON.parse(readFileSync(new URL("./agent/opencode.json", import.meta.url), "utf8")) as {
    permission: { bash: Record<string, string> };
  };
  const rules = config.permission.bash;
  assert.equal(rules["*"], "allow");
  for (const pattern of ["*gradlew*", "*cloud-gradle.sh*", "gh *", "*git stash*", "*git reset --hard*", "*git push*", "*pkill *", "*killall *", "*--no-verify*"])
    assert.equal(rules[pattern], "deny", pattern);
  // The tools' own command lines must not match a denied pattern.
  for (const tool of ["gradle", "find-symbol", "lib-source"]) {
    const command = `.sandcastle/agent/bin/${tool} qualityGate`;
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "deny") continue;
      const expression = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      assert.equal(expression.test(command), false, `${pattern} denies ${command}`);
    }
  }
});
