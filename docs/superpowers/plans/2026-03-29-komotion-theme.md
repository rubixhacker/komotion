# Komotion Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Material-style `komotion-theme` module with shared color/shape/typography tokens, then migrate `komotion-algo-viz` to use it instead of its standalone `AlgoVizTheme`.

**Architecture:** Three token data classes (`KomotionColors`, `KomotionShapes`, `KomotionTypography`) provided via CompositionLocals through a `KomotionTheme` composable and companion object. `komotion-algo-viz` drops its color/font fields, keeps domain-specific sizing as `AlgoVizSizing` with a `KomotionTheme.algoViz` extension property.

**Tech Stack:** Kotlin Multiplatform, Compose UI (CompositionLocal, CornerBasedShape, TextStyle, FontFamily)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `komotion-theme/build.gradle.kts` | Create | Module build config (KMP, all targets) |
| `settings.gradle.kts` | Modify | Add `:komotion-theme` |
| `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionColors.kt` | Create | Color tokens |
| `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionShapes.kt` | Create | Shape tokens |
| `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTypography.kt` | Create | Typography tokens |
| `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTheme.kt` | Create | Object + composable + locals |
| `komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionColorsTest.kt` | Create | Color defaults test |
| `komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionTypographyTest.kt` | Create | Typography defaults test |
| `komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionThemeTest.kt` | Create | Composable provider test |
| `komotion-algo-viz/build.gradle.kts` | Modify | Add komotion-theme dependency |
| `komotion-algo-viz/.../theme/AlgoVizTheme.kt` | Rewrite | Becomes AlgoVizSizing.kt |
| `komotion-algo-viz/.../components/ArrayViz.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../components/GraphViz.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../components/TreeViz.kt` | Modify | No change (delegates to GraphViz) |
| `komotion-algo-viz/.../components/StackQueueViz.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../components/PointerMarker.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../components/StepLabel.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../components/ComparisonIndicator.kt` | Modify | Use KomotionTheme |
| `komotion-algo-viz/.../theme/AlgoVizThemeTest.kt` | Rewrite | Test AlgoVizSizing + KomotionTheme integration |

---

### Task 1: Scaffold komotion-theme module

**Files:**
- Create: `komotion-theme/build.gradle.kts`
- Modify: `settings.gradle.kts`

- [ ] **Step 1: Create build.gradle.kts**

```kotlin
import com.vanniktech.maven.publish.KotlinMultiplatform
import com.vanniktech.maven.publish.SonatypeHost

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.mavenPublish)
}

apply(from = rootProject.file("gradle/publish.gradle.kts"))

mavenPublishing {
    configure(KotlinMultiplatform(javadocJar = com.vanniktech.maven.publish.JavadocJar.Empty()))
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL)
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
    }

    pom {
        name.set("komotion-theme")
        description.set(providers.gradleProperty("POM_DESCRIPTION"))
        url.set(providers.gradleProperty("POM_URL"))
        licenses {
            license {
                name.set(providers.gradleProperty("POM_LICENCE_NAME"))
                url.set(providers.gradleProperty("POM_LICENCE_URL"))
            }
        }
        developers {
            developer {
                id.set(providers.gradleProperty("POM_DEVELOPER_ID"))
                name.set(providers.gradleProperty("POM_DEVELOPER_NAME"))
            }
        }
        scm {
            url.set(providers.gradleProperty("POM_SCM_URL"))
            connection.set(providers.gradleProperty("POM_SCM_CONNECTION"))
            developerConnection.set(providers.gradleProperty("POM_SCM_DEV_CONNECTION"))
        }
    }
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        }
    }
    iosArm64()
    iosX64()
    iosSimulatorArm64()
    jvm("desktop") {
        compilerOptions {
            jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        }
    }
    wasmJs { browser() }

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.ui)
            implementation(compose.foundation)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
        val desktopTest by getting {
            dependencies {
                implementation(libs.skiko.awt.runtime.linux.x64)
            }
        }
    }
}

android {
    namespace = "dev.boling.komotion.theme"
    compileSdk = 35
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
```

- [ ] **Step 2: Add to settings.gradle.kts**

Add after existing includes:
```kotlin
include(":komotion-theme")
```

- [ ] **Step 3: Create source directories**

```bash
mkdir -p komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme
mkdir -p komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme
```

- [ ] **Step 4: Verify Gradle sync**

Run: `./gradlew :komotion-theme:tasks`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add komotion-theme/build.gradle.kts settings.gradle.kts
git commit -m "feat(theme): scaffold komotion-theme module"
```

---

### Task 2: KomotionColors

**Files:**
- Create: `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionColors.kt`
- Create: `komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionColorsTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals

class KomotionColorsTest {

    @Test
    fun `default colors match spec values`() {
        val colors = KomotionColors()
        assertEquals(Color(0xFF0D0F14), colors.background)
        assertEquals(Color(0xFF1A1D26), colors.surface)
        assertEquals(Color(0xFF00FFA3), colors.accent)
        assertEquals(Color(0xFF7B61FF), colors.accent2)
        assertEquals(Color(0xFFE8EAF0), colors.text)
        assertEquals(Color(0xFF6B7280), colors.muted)
        assertEquals(Color(0xFFFF6B6B), colors.error)
    }

    @Test
    fun `custom colors override defaults`() {
        val custom = KomotionColors(accent = Color.Red)
        assertEquals(Color.Red, custom.accent)
        assertEquals(Color(0xFF0D0F14), custom.background)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :komotion-theme:desktopTest`
Expected: FAIL

- [ ] **Step 3: Implement KomotionColors**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.ui.graphics.Color

data class KomotionColors(
    val background: Color = Color(0xFF0D0F14),
    val surface: Color = Color(0xFF1A1D26),
    val accent: Color = Color(0xFF00FFA3),
    val accent2: Color = Color(0xFF7B61FF),
    val text: Color = Color(0xFFE8EAF0),
    val muted: Color = Color(0xFF6B7280),
    val error: Color = Color(0xFFFF6B6B),
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew :komotion-theme:desktopTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionColors.kt \
       komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionColorsTest.kt
git commit -m "feat(theme): add KomotionColors with 7 color tokens"
```

---

### Task 3: KomotionShapes + KomotionTypography

**Files:**
- Create: `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionShapes.kt`
- Create: `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTypography.kt`
- Create: `komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionTypographyTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import kotlin.test.Test
import kotlin.test.assertEquals

class KomotionTypographyTest {

    @Test
    fun `default typography uses Monospace`() {
        val typo = KomotionTypography()
        assertEquals(FontFamily.Monospace, typo.fontFamily)
    }

    @Test
    fun `default font sizes match spec`() {
        val typo = KomotionTypography()
        assertEquals(48.sp, typo.display.fontSize)
        assertEquals(24.sp, typo.title.fontSize)
        assertEquals(16.sp, typo.body.fontSize)
        assertEquals(12.sp, typo.label.fontSize)
        assertEquals(14.sp, typo.code.fontSize)
    }

    @Test
    fun `code style always uses Monospace`() {
        val typo = KomotionTypography()
        assertEquals(FontFamily.Monospace, typo.code.fontFamily)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :komotion-theme:desktopTest`
Expected: FAIL

- [ ] **Step 3: Implement KomotionShapes**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

data class KomotionShapes(
    val small: CornerBasedShape = RoundedCornerShape(4.dp),
    val medium: CornerBasedShape = RoundedCornerShape(8.dp),
    val large: CornerBasedShape = RoundedCornerShape(16.dp),
)
```

- [ ] **Step 4: Implement KomotionTypography**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

data class KomotionTypography(
    val fontFamily: FontFamily = FontFamily.Monospace,
    val display: TextStyle = TextStyle(fontSize = 48.sp),
    val title: TextStyle = TextStyle(fontSize = 24.sp),
    val body: TextStyle = TextStyle(fontSize = 16.sp),
    val label: TextStyle = TextStyle(fontSize = 12.sp),
    val code: TextStyle = TextStyle(fontSize = 14.sp, fontFamily = FontFamily.Monospace),
)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./gradlew :komotion-theme:desktopTest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionShapes.kt \
       komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTypography.kt \
       komotion-theme/src/commonTest/kotlin/dev/boling/komotion/theme/KomotionTypographyTest.kt
git commit -m "feat(theme): add KomotionShapes and KomotionTypography"
```

---

### Task 4: KomotionTheme object + composable

**Files:**
- Create: `komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTheme.kt`

- [ ] **Step 1: Implement KomotionTheme**

```kotlin
package dev.boling.komotion.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf

internal val LocalKomotionColors = compositionLocalOf { KomotionColors() }
internal val LocalKomotionShapes = compositionLocalOf { KomotionShapes() }
internal val LocalKomotionTypography = compositionLocalOf { KomotionTypography() }

object KomotionTheme {
    val colors: KomotionColors
        @Composable get() = LocalKomotionColors.current
    val shapes: KomotionShapes
        @Composable get() = LocalKomotionShapes.current
    val typography: KomotionTypography
        @Composable get() = LocalKomotionTypography.current
}

@Composable
fun KomotionTheme(
    colors: KomotionColors = KomotionColors(),
    shapes: KomotionShapes = KomotionShapes(),
    typography: KomotionTypography = KomotionTypography(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalKomotionColors provides colors,
        LocalKomotionShapes provides shapes,
        LocalKomotionTypography provides typography,
    ) {
        content()
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `./gradlew :komotion-theme:compileKotlinDesktop`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add komotion-theme/src/commonMain/kotlin/dev/boling/komotion/theme/KomotionTheme.kt
git commit -m "feat(theme): add KomotionTheme object, composable, and CompositionLocals"
```

---

### Task 5: Add komotion-theme dependency to algo-viz + replace AlgoVizTheme with AlgoVizSizing

**Files:**
- Modify: `komotion-algo-viz/build.gradle.kts`
- Rewrite: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizTheme.kt` (rename to AlgoVizSizing.kt)
- Rewrite: `komotion-algo-viz/src/commonTest/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizThemeTest.kt` (rename to AlgoVizSizingTest.kt)

- [ ] **Step 1: Add komotion-theme dependency**

In `komotion-algo-viz/build.gradle.kts`, in `commonMain.dependencies`, add:

```kotlin
implementation(project(":komotion-theme"))
```

- [ ] **Step 2: Delete old AlgoVizTheme.kt and create AlgoVizSizing.kt**

Delete `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizTheme.kt`.

Create `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizSizing.kt`:

```kotlin
package dev.boling.komotion.algoviz.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.boling.komotion.theme.KomotionTheme

data class AlgoVizSizing(
    val cellSize: Dp = 56.dp,
    val cellBorderWidth: Dp = 2.dp,
    val nodeRadius: Dp = 22.dp,
    val nodeStrokeWidth: Dp = 2.dp,
    val eliminatedOpacity: Float = 0.2f,
)

val LocalAlgoVizSizing = compositionLocalOf { AlgoVizSizing() }

val KomotionTheme.algoViz: AlgoVizSizing
    @Composable get() = LocalAlgoVizSizing.current
```

- [ ] **Step 3: Delete old test and create AlgoVizSizingTest.kt**

Delete `komotion-algo-viz/src/commonTest/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizThemeTest.kt`.

Create `komotion-algo-viz/src/commonTest/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizSizingTest.kt`:

```kotlin
package dev.boling.komotion.algoviz.theme

import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

class AlgoVizSizingTest {

    @Test
    fun `default sizing matches original AlgoVizTheme values`() {
        val sizing = AlgoVizSizing()
        assertEquals(56.dp, sizing.cellSize)
        assertEquals(2.dp, sizing.cellBorderWidth)
        assertEquals(22.dp, sizing.nodeRadius)
        assertEquals(2.dp, sizing.nodeStrokeWidth)
        assertEquals(0.2f, sizing.eliminatedOpacity)
    }

    @Test
    fun `custom sizing overrides defaults`() {
        val custom = AlgoVizSizing(cellSize = 80.dp)
        assertEquals(80.dp, custom.cellSize)
        assertEquals(2.dp, custom.cellBorderWidth)
    }
}
```

- [ ] **Step 4: Verify tests pass (compilation will fail until components are migrated — just verify the test files compile in isolation)**

Run: `./gradlew :komotion-algo-viz:compileKotlinDesktop` — this will FAIL because components still reference `LocalAlgoVizTheme`. That's expected — Task 6 fixes them.

- [ ] **Step 5: Commit**

```bash
git add komotion-algo-viz/build.gradle.kts \
       komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizSizing.kt \
       komotion-algo-viz/src/commonTest/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizSizingTest.kt
git rm komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizTheme.kt \
       komotion-algo-viz/src/commonTest/kotlin/dev/boling/komotion/algoviz/theme/AlgoVizThemeTest.kt
git commit -m "feat(algo-viz): replace AlgoVizTheme with AlgoVizSizing, add komotion-theme dep"
```

---

### Task 6: Migrate all algo-viz components to KomotionTheme

**Files:**
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/ArrayViz.kt`
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/GraphViz.kt`
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/StackQueueViz.kt`
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/PointerMarker.kt`
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/StepLabel.kt`
- Modify: `komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/ComparisonIndicator.kt`

This is a mechanical migration. In every component file, apply these changes:

- [ ] **Step 1: In each file, replace the import**

Replace:
```kotlin
import dev.boling.komotion.algoviz.theme.LocalAlgoVizTheme
```
With:
```kotlin
import dev.boling.komotion.algoviz.theme.LocalAlgoVizSizing
import dev.boling.komotion.theme.KomotionTheme
```

- [ ] **Step 2: In each file, replace `val theme = LocalAlgoVizTheme.current`**

Replace with two lines:
```kotlin
val colors = KomotionTheme.colors
val sizing = LocalAlgoVizSizing.current
```

Exception: `StackQueueViz.kt` has this in two places (the composable and the private `StackQueueCell`) — replace both.

- [ ] **Step 3: In each file, replace `theme.` references**

Color references (`theme.accent`, `theme.surface`, `theme.text`, `theme.muted`, `theme.accent2`) become `colors.accent`, `colors.surface`, etc.

Sizing references (`theme.cellSize`, `theme.cellBorderWidth`, `theme.nodeRadius`, `theme.nodeStrokeWidth`, `theme.eliminatedOpacity`, `theme.cellCornerRadius`) become `sizing.cellSize`, `sizing.cellBorderWidth`, etc.

Font references (`theme.fontFamily`) become `KomotionTheme.typography.fontFamily` — but since `KomotionTheme.typography` is `@Composable`, extract it at the top of each composable:
```kotlin
val typography = KomotionTheme.typography
```
Then use `typography.fontFamily`.

Shape references: replace hardcoded `RoundedCornerShape(theme.cellCornerRadius)` with `KomotionTheme.shapes.medium` (8.dp = medium). Extract at top:
```kotlin
val shapes = KomotionTheme.shapes
```

- [ ] **Step 4: Update `resolveCellColors` and similar helper functions**

These private functions currently take `AlgoVizTheme` as a parameter. Change them to take `KomotionColors`:

In `ArrayViz.kt`, change:
```kotlin
private fun resolveCellColors(highlight: HighlightState, theme: dev.boling.komotion.algoviz.theme.AlgoVizTheme): CellColors
```
To:
```kotlin
private fun resolveCellColors(highlight: HighlightState, colors: KomotionColors): CellColors
```

And update the body to use `colors.surface`, `colors.accent`, etc. instead of `theme.surface`, `theme.accent`, etc.

Same pattern for `resolveNodeColor` and `resolveNodeFill` in `GraphViz.kt`, and `resolveSQCellColors` in `StackQueueViz.kt`.

- [ ] **Step 5: Verify compilation**

Run: `./gradlew :komotion-algo-viz:compileKotlinDesktop`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Run all tests**

Run: `./gradlew :komotion-theme:desktopTest :komotion-algo-viz:desktopTest`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add komotion-algo-viz/src/commonMain/kotlin/dev/boling/komotion/algoviz/components/
git commit -m "refactor(algo-viz): migrate all components from AlgoVizTheme to KomotionTheme"
```

---

### Task 7: Final validation + version bump

- [ ] **Step 1: Run full project tests**

Run: `./gradlew :komotion-core:desktopTest :komotion-theme:desktopTest :komotion-export-desktop:desktopTest :komotion-algo-viz:desktopTest`
Expected: All tests PASS

- [ ] **Step 2: Bump version to 0.4.0**

In `gradle.properties`, change `VERSION_NAME=0.3.0` to `VERSION_NAME=0.4.0`.

- [ ] **Step 3: Publish to mavenLocal**

Run: `./gradlew publishToMavenLocal`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit, push, tag**

```bash
git add gradle.properties
git commit -m "chore: bump version to 0.4.0 — adds komotion-theme module"
git push origin main
git tag v0.4.0
git push origin v0.4.0
```
