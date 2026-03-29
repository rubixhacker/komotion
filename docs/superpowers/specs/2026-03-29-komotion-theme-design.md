# Komotion Theme System — Design Spec

**Date:** 2026-03-29
**Status:** Approved

## Problem

`komotion-algo-viz` has its own standalone `AlgoVizTheme` with colors, fonts, and sizing baked together. Other modules (future or third-party like `komotion-shared`) each define their own theme classes. No shared color/typography/shape tokens exist across the ecosystem, forcing channels to configure each module's theme separately.

## Solution

A new `komotion-theme` module providing Material-style theme tokens (`KomotionColors`, `KomotionShapes`, `KomotionTypography`) via CompositionLocals. Module-specific tokens (like algo-viz sizing) attach as extension properties on `KomotionTheme`. Core stays unopinionated.

## Dependency Graph

```
komotion-core  <-- komotion-algo-viz
komotion-theme <-/
```

`komotion-core` has no dependency on `komotion-theme`. `komotion-algo-viz` depends on both.

## Module: komotion-theme

### KomotionColors

```kotlin
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

### KomotionShapes

```kotlin
data class KomotionShapes(
    val small: CornerBasedShape = RoundedCornerShape(4.dp),
    val medium: CornerBasedShape = RoundedCornerShape(8.dp),
    val large: CornerBasedShape = RoundedCornerShape(16.dp),
)
```

### KomotionTypography

```kotlin
data class KomotionTypography(
    val fontFamily: FontFamily = FontFamily.Monospace,
    val display: TextStyle = TextStyle(fontSize = 48.sp),
    val title: TextStyle = TextStyle(fontSize = 24.sp),
    val body: TextStyle = TextStyle(fontSize = 16.sp),
    val label: TextStyle = TextStyle(fontSize = 12.sp),
    val code: TextStyle = TextStyle(fontSize = 14.sp, fontFamily = FontFamily.Monospace),
)
```

### KomotionTheme Object + Composable

```kotlin
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

Three internal CompositionLocals:
```kotlin
internal val LocalKomotionColors = compositionLocalOf { KomotionColors() }
internal val LocalKomotionShapes = compositionLocalOf { KomotionShapes() }
internal val LocalKomotionTypography = compositionLocalOf { KomotionTypography() }
```

## Module: komotion-algo-viz (refactored)

### AlgoVizSizing (replaces AlgoVizTheme)

```kotlin
data class AlgoVizSizing(
    val cellSize: Dp = 56.dp,
    val cellBorderWidth: Dp = 2.dp,
    val nodeRadius: Dp = 22.dp,
    val nodeStrokeWidth: Dp = 2.dp,
    val eliminatedOpacity: Float = 0.2f,
)

val LocalAlgoVizSizing = compositionLocalOf { AlgoVizSizing() }
```

### Extension property on KomotionTheme

```kotlin
val KomotionTheme.algoViz: AlgoVizSizing
    @Composable get() = LocalAlgoVizSizing.current
```

### Component migration

All algo-viz components change from:
```kotlin
val theme = LocalAlgoVizTheme.current
theme.accent  // color
theme.cellSize // sizing
```

To:
```kotlin
val colors = KomotionTheme.colors
val shapes = KomotionTheme.shapes
val sizing = KomotionTheme.algoViz
```

The `resolveCellColors` and `resolveNodeColor` helpers change their `AlgoVizTheme` parameter to `KomotionColors`.

### Removed

- `AlgoVizTheme` data class — replaced by `KomotionColors` + `KomotionShapes` + `KomotionTypography` + `AlgoVizSizing`
- `AlgoVizThemeProvider` composable — replaced by `KomotionTheme()`
- `LocalAlgoVizTheme` CompositionLocal — replaced by the three `komotion-theme` locals + `LocalAlgoVizSizing`

## Channel Usage

```kotlin
// BigOBriefs Main.kt
KomotionTheme(
    colors = KomotionColors(
        background = Color(0xFF0D0F14),
        accent = Color(0xFF00FFA3),
        accent2 = Color(0xFF7B61FF),
        // ...
    ),
) {
    // Optional: customize algo-viz sizing
    CompositionLocalProvider(LocalAlgoVizSizing provides AlgoVizSizing(cellSize = 64.dp)) {
        BinarySearchVideo()
        BfsDfsVideo()
    }
}
```

## File Structure

```
komotion-theme/
  build.gradle.kts
  src/commonMain/kotlin/dev/boling/komotion/theme/
    KomotionColors.kt
    KomotionShapes.kt
    KomotionTypography.kt
    KomotionTheme.kt          -- object + composable + locals
  src/commonTest/kotlin/dev/boling/komotion/theme/
    KomotionColorsTest.kt
    KomotionTypographyTest.kt
    KomotionThemeTest.kt

komotion-algo-viz/ (modified)
  build.gradle.kts             -- add komotion-theme dependency
  src/commonMain/kotlin/dev/boling/komotion/algoviz/
    theme/
      AlgoVizSizing.kt         -- replaces AlgoVizTheme.kt
    components/
      ArrayViz.kt              -- migrate to KomotionTheme
      GraphViz.kt              -- migrate to KomotionTheme
      StackQueueViz.kt         -- migrate to KomotionTheme
      PointerMarker.kt         -- migrate to KomotionTheme
      StepLabel.kt             -- migrate to KomotionTheme
      ComparisonIndicator.kt   -- migrate to KomotionTheme
```

## Testing

- **KomotionColors:** defaults match spec values, custom overrides work
- **KomotionTypography:** defaults match spec, code style uses Monospace
- **KomotionTheme composable:** provides all three locals correctly
- **AlgoVizSizing:** defaults match current AlgoVizTheme sizing values
- **Component migration:** existing algo-viz tests pass after migration (they may need wrapping in `KomotionTheme {}`)

## Out of Scope

- Migrating `komotion-shared` to use `KomotionTheme` (separate effort coordinated with channels)
- Dark/light theme variants
- Dynamic theme switching
