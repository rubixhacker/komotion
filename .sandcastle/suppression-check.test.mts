import { test } from "node:test";
import assert from "node:assert/strict";
import { addedSuppressions, suppressionFindings } from "./suppression-check.mjs";

function diff(file: string, body: readonly string[], start = 10): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -${start},3 +${start},4 @@`, ...body].join("\n");
}

test("a suppression added to production code is found with its line", () => {
  const found = addedSuppressions(
    diff("androidApp/src/main/kotlin/ui/TodayScreen.kt", [
      " fun TodayScreen() {",
      '+    @Suppress("RawComposeSpacingLiteral")',
      "+    Column(Modifier.padding(12.dp)) {}",
      " }",
    ]),
  );
  assert.deepEqual(found, [
    { file: "androidApp/src/main/kotlin/ui/TodayScreen.kt", line: 11, text: '@Suppress("RawComposeSpacingLiteral")' },
  ]);
  assert.match(suppressionFindings(found), /adds 1 suppression\(s\) or baseline entry\./);
  assert.match(suppressionFindings(found), /TodayScreen\.kt:11/);
});

test("every way of hiding a finding counts, in Kotlin, Swift, XML and baselines", () => {
  const cases: Array<[string, string]> = [
    ["shared/data/consumption/internal/src/commonMain/kotlin/A.kt", '@file:Suppress("TooManyFunctions")'],
    ["androidApp/src/main/kotlin/A.kt", '@SuppressLint("NewApi")'],
    ["iosApp/CaffConscious/TodayView.swift", "// swiftlint:disable:next force_cast"],
    ["androidApp/src/main/AndroidManifest.xml", '<activity tools:ignore="LockedOrientationActivity" />'],
    ["config/detekt/baseline.xml", "<ID>LongMethod:Chart.kt$fun draw()</ID>"],
    ["config/localization/moko-orphaned-baseline.tsv", "today_title\tunused"],
  ];
  for (const [file, text] of cases)
    assert.equal(addedSuppressions(diff(file, [`+${text}`])).length, 1, `${file}: ${text}`);
});

test("a moved suppression, ordinary code, and test sources are not findings", () => {
  const moved = diff("androidApp/src/main/kotlin/A.kt", [
    '-@Suppress("LongMethod") // LongMethod: one table',
    " fun other() {}",
    '+@Suppress("LongMethod") // LongMethod: one table',
  ]);
  assert.deepEqual(addedSuppressions(moved), []);
  assert.deepEqual(addedSuppressions(diff("androidApp/src/main/kotlin/A.kt", ["+val suppressed = true"])), []);
  assert.deepEqual(
    addedSuppressions(diff("androidApp/src/test/kotlin/ATest.kt", ['+@Suppress("UNCHECKED_CAST")'])),
    [],
  );
  assert.deepEqual(addedSuppressions(diff("docs/adr/0090-x.md", ["+Use `@Suppress(` sparingly."])), []);
  assert.deepEqual(addedSuppressions(diff(".sandcastle/suppression-check.mts", ["+// swiftlint:disable is a pattern"])), []);
});

test("a test switched off is the same bypass", () => {
  assert.equal(addedSuppressions(diff("iosApp/CaffConsciousTests/ChartTests.swift", ['+        throw XCTSkip("flaky")'])).length, 1);
  assert.equal(addedSuppressions(diff("androidApp/src/test/kotlin/ATest.kt", ["+    @Ignore"])).length, 1);
});

test("two files in one diff keep their own removed lines", () => {
  const both = [
    diff("androidApp/src/main/kotlin/A.kt", ['-@Suppress("LongMethod")']),
    diff("androidApp/src/main/kotlin/B.kt", ['+@Suppress("LongMethod")']),
  ].join("\n");
  assert.equal(addedSuppressions(both).length, 1);
  assert.equal(addedSuppressions(both)[0]?.file, "androidApp/src/main/kotlin/B.kt");
});
