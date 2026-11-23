# Komotion

Frame-driven video animation for Compose Multiplatform.

Komotion lets you build video compositions as `@Composable` functions where every animation is a pure function of the current frame number. This makes animations deterministic, scrubbable, and trivially exportable to MP4.

Think [Remotion](https://www.remotion.dev/) — but for Kotlin and Compose.

<p align="center">
  <img src="docs/demo.gif" alt="Komotion TitleCard demo" width="480">
</p>

Terminology follows [GLOSSARY.md](GLOSSARY.md); architectural decisions are recorded in [docs/adr/](docs/adr/).

## Modules

| Module | Targets | Description |
|--------|---------|-------------|
| `komotion-core` | Android, iOS, Desktop, wasmJs | Composition model, frame-driven timing (`Sequence`, `Series`, `Freeze`, `Loop`, `TransitionSeries`), interpolation and springs |
| `komotion-player` | Android, iOS, Desktop, wasmJs | Embedded player with play/pause, scrub, loop, and frame counter |
| `komotion-export-desktop` | Desktop (JVM) | MP4 export via FFmpeg with audio mixing and video frame extraction |
| `komotion-theme` | Android, iOS, Desktop, wasmJs | Shared design tokens: `KomotionTheme` with colors, typography and shapes |
| `komotion-algo-viz` | Android, iOS, Desktop, wasmJs | Algorithm visualizations for arrays, graphs, trees, stacks and queues |
| `sample-app` | Android, iOS, Desktop, wasmJs | Demo compositions and the player sandbox |

## Quick Start

```kotlin
// Define your animation as a composable
@Composable
fun HelloVideo() {
    val frame = currentFrame()
    val opacity = interpolate(frame, 0..30, 0f..1f, options = InterpolateOptions(easing = listOf(spring())))

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Text(
            "Hello, Komotion!",
            color = Color.White,
            fontSize = 48.sp,
            modifier = Modifier.graphicsLayer(alpha = opacity)
        )
    }
}

// Preview it with the built-in player
@Composable
fun Preview() {
    val composition = Composition(width = 1920, height = 1080, durationInFrames = 60, fps = 30)
    KomotionPlayer(composition) {
        HelloVideo()
    }
}

// Export to MP4 (desktop only)
suspend fun export() {
    val composition = Composition(width = 1920, height = 1080, durationInFrames = 60, fps = 30)
    val renderer = FfmpegFrameRenderer()
    renderer.render(composition, "output.mp4", content = {
        HelloVideo()
    })
}
```

## Authoring

### Frame & Composition

A `Composition` describes the video: width, height, frame rate and duration in frames. Every composable inside a composition reads the current frame with `currentFrame()` — the only way composition code should obtain the frame:

```kotlin
val frame = currentFrame()                  // 0-based frame index
val comp = LocalComposition.current         // width, height, fps, durationInFrames
```

`LocalFrame` is the underlying composition local that `currentFrame()` reads. Prefer `currentFrame()`; read `LocalFrame.current` directly only when you need the raw local (for example, to provide a different frame via `CompositionLocalProvider`).

### AbsoluteFill

`Sequence` adds no layout wrapper by default — children lay out directly in the parent. Use `AbsoluteFill` for overlay content that should fill the parent's space:

```kotlin
AbsoluteFill {
    Text("Overlay")
}
```

### Experimental APIs

New timing primitives (`Series`, `TransitionSeries`, `Freeze`, `Loop`) are marked `@ExperimentalKomotionApi`. Opt in at the call site:

```kotlin
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun MyComposition() { ... }
```

## Timing

### Sequence

Time-window a section of your composition. Children see `LocalFrame` re-based to 0 at `from`:

```kotlin
Sequence(from = 0, durationInFrames = 30) {
    // currentFrame() here is 0..29
    val frame = currentFrame()
    val opacity = interpolate(frame, 0..30, 0f..1f)
    Text("Intro", modifier = Modifier.graphicsLayer(alpha = opacity))
}

Sequence(from = 30, durationInFrames = 30) {
    // currentFrame() here is 0..29
    Text("Main content")
}
```

`durationInFrames` is optional — when omitted, the sequence runs until the parent ends. The other timing options:

```kotlin
Sequence(
    from = 0,
    durationInFrames = 30,
    trimBefore = 5,        // children start 5 child frames "early" (negative frames, clamped by interpolation)
    playbackRate = 2.0,   // children play at 2x speed; the window is 15 parent frames long
    freeze = null,        // pin the child to one frame, e.g. freeze = 15
    loop = false,         // repeat the trimmed range until the parent ends (needs finite durationInFrames)
    name = "intro",       // carried via LocalSequenceName for timeline display
) {
    // ...
}
```

Outside the window the sequence emits a zero-size layout, so it reserves no space in the parent.

### Series

A scoped DSL for sequential scenes: each scene starts when the previous one ends, and each scene's children see a frame clock re-based to 0 at the scene's start. A positive `offset` leaves a gap after the previous scene; a negative `offset` overlaps it. The last scene may be infinite — pass a negative `durationInFrames` to run it until the end of the composition:

```kotlin
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun MyVideo() {
    Series {
        Sequence(durationInFrames = 40) { Intro() }
        Sequence(durationInFrames = 20, offset = -10) { Main() } // overlaps Intro's last 10 frames
        Sequence(durationInFrames = -1) { Outro() }              // runs to the end
    }
}
```

### Freeze

Pins the frame to an absolute value for its content, regardless of the parent's frame — a snapshot of an animation at a specific moment while the surrounding timeline continues:

```kotlin
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun FreezeDemo() {
    Freeze(frame = 15) {
        // Always sees frame 15
        val opacity = interpolate(currentFrame(), 0..30, 0f..1f)
        Text("Frozen", modifier = Modifier.graphicsLayer(alpha = opacity))
    }
}
```

### Loop

Cycles the frame modulo `durationInFrames`, so the subtree animates on a repeating cycle. To bound how many times it repeats, wrap it in a `Sequence` that limits the window:

```kotlin
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun Pulse() {
    Sequence(from = 30, durationInFrames = 90) {  // 3 iterations of a 30-frame loop
        Loop(durationInFrames = 30) {
            val frame = currentFrame()
            val scale = interpolate(frame, 0..15, 1f..1.4f)
            Box(Modifier.size(120.dp * scale))
        }
    }
}
```

### TransitionSeries

Alternates scenes and transitions. Each transition consumes `durationInFrames` of overlap from the scene before it and the scene after it, so the total timeline is the sum of the scene durations minus the overlaps. During the overlap the two adjacent scenes are rendered together, blended by the transition:

```kotlin
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun MyVideo() {
    TransitionSeries {
        Scene(40) { TitleCard() }
        Fade(durationInFrames = 10)
        Scene(30) { BarChart() }
        Slide(durationInFrames = 20)
        Scene(30) { Outro() }
    }
}
```

Available transitions: `Fade`, `Slide`, `Wipe`, `Iris` and `ClockWipe`, each with an optional `easing` (and a `direction` for `Slide`/`Wipe`). The scope is a plain value object, so you can compute `scope.totalDurationInFrames` outside a composable context (for example for a `Composition`) and render it with `TransitionSeries(scope)`.

### Interpolation

Pure functions — deterministic, no Compose context needed. Every animated value is `currentFrame()` piped through one of these:

```kotlin
interpolate(frame, 0..30, 0f..1f)                           // Float
interpolateInt(frame, 0..60, 0..100)                         // Int
interpolateColor(frame, 0..30, Color.Black, Color.White)     // Color
interpolateDp(frame, 0..30, 0.dp, 16.dp)                    // Dp
```

The keyframe form accepts lists of equal length (at least one element, strictly increasing), so a single call can drive a multi-segment animation:

```kotlin
interpolate(frame, listOf(0, 30, 60), listOf(0f, 1f, 0f))
```

Behavior is controlled with `InterpolateOptions`:

```kotlin
InterpolateOptions(
    extrapolateLeft = ExtrapolateMode.clamp,   // clamp | extend | wrap | identity
    extrapolateRight = ExtrapolateMode.clamp,  // clamp is the default
    posterize = 3,                             // quantize the input to a step (e.g. 3 = 10 fps at 30 fps)
    easing = listOf(LinearEasing),             // one easing, or one per segment
)
```

`interpolateFloats` interpolates every component of a `FloatArray` independently:

```kotlin
interpolateFloats(frame, listOf(0, 20), listOf(floatArrayOf(0f, 0f), floatArrayOf(100f, 50f)))
```

### Spring Easing

Physics-based spring compatible with all interpolation functions:

```kotlin
spring()                              // Default: slightly bouncy (damping=0.7)
spring(damping = 0.3f)                // Very bouncy, overshoots
spring(damping = 1.0f)                // Critically damped, no overshoot
spring(damping = 2.0f, stiffness = 50f)  // Overdamped, sluggish

// Use with any interpolation
val frame = currentFrame()
val scale = interpolate(frame, 0..20, 0.8f..1f, options = InterpolateOptions(easing = listOf(spring(damping = 0.5f))))
```

### Spring Values

`springValue` returns the spring's value at a frame directly, without keyframes:

```kotlin
val config = SpringConfig(damping = 0.3f) // bouncy
val position = springValue(
    frame = currentFrame(),
    fps = 30,
    config = config,
    from = 0f,
    to = 300f,
    durationInFrames = 40,
    delay = 5,               // hold `from` for 5 frames
    reverse = false,         // true plays the curve backwards (from `to` to `from`)
    overshootClamping = false // true clamps the value to the from→to interval
)

// How many frames a spring takes to settle at a given fps:
val settleFrames = measureSpring(config, fps = 30, threshold = 0.01f)
```

`springValue` and `spring` share one solver, so the value function and the easing curve never disagree.

## Media

### Audio Tracks

Declare audio files to be mixed into the exported MP4:

```kotlin
val audioTracks = listOf(
    AudioTrack(file = "/path/to/intro.wav", startFrame = 0),
    AudioTrack(file = "/path/to/main.wav", startFrame = 90),
)

renderer.render(composition, "output.mp4", audioTracks = audioTracks, content = {
    MyComposition()
})
```

Audio is mixed via FFmpeg `adelay` + `amix` during export. Preview playback is silent.

### Video Frame Extraction

Embed pre-rendered MP4 clips in your composition (desktop export only):

```kotlin
@Composable
fun DemoSegment(videoPath: String) {
    val frame = currentFrame()
    val videoFrame = rememberVideoFrame(videoFile = videoPath, frameIndex = frame)

    Box(Modifier.fillMaxSize()) {
        if (videoFrame != null) {
            Image(bitmap = videoFrame, contentDescription = null, modifier = Modifier.fillMaxSize())
        } else {
            Box(Modifier.fillMaxSize().background(Color.Gray)) // Preview placeholder
        }
    }
}
```

In preview the composable returns `null` so you can show a placeholder; during export the renderer decodes the real frame for each output frame.

## Captions

Captions are timed text overlays built from the core timing primitives — one `Sequence` per caption, re-based so each caption's text fades in over its own window:

```kotlin
data class Caption(val text: String, val startFrame: Int, val endFrame: Int)

@Composable
fun Captions(captions: List<Caption>) {
    captions.forEach { caption ->
        Sequence(from = caption.startFrame, durationInFrames = caption.endFrame - caption.startFrame) {
            val frame = currentFrame()
            val opacity = interpolate(frame, 0..10, 0f..1f)
            AbsoluteFill {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    Text(
                        text = caption.text,
                        color = Color.White.copy(alpha = opacity),
                        fontSize = 24.sp,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        }
    }
}
```

## Fonts

`komotion-theme` provides shared design tokens: `KomotionColors`, `KomotionTypography` and `KomotionShapes`, exposed through `KomotionTheme`. `KomotionTypography` carries the `fontFamily` and a set of `TextStyle` tokens (display, title, body, label, code):

```kotlin
@Composable
fun StyledTitle() {
    Text(
        text = "Komotion",
        style = KomotionTheme.typography.display,
        color = KomotionTheme.colors.accent,
    )
}
```

Override any token by passing a customized `KomotionTheme(...)` wrapper around your composition.

## Player

`KomotionPlayer` embeds a composition with transport controls: play/pause, skip to start/end, scrub, loop toggle and a frame counter:

```kotlin
@Composable
fun Preview() {
    val composition = Composition(width = 1920, height = 1080, durationInFrames = 60, fps = 30)
    KomotionPlayer(
        composition = composition,
        initialFrame = 0,
        loop = true,
        autoPlay = false,
    ) {
        HelloVideo()
    }
}
```

Playback is wall-clock driven and corrected for scrubbing; the frame it reports is always a pure function of the player's current state, so preview and export agree frame for frame.

## Export

`FfmpegFrameRenderer` (desktop only) renders a composition frame-by-frame offscreen and encodes it to MP4 with FFmpeg:

```kotlin
val renderer = FfmpegFrameRenderer(
    crf = 18,                              // quality (lower = better)
    preset = FfmpegPreset.Medium,          // UltraFast | Fast | Medium | Slow | VerySlow
    renderMode = RenderMode.Pipe,          // Pipe (raw pixels to FFmpeg) or PngSequence (PNG files, for debugging)
)

// Blocking:
renderer.render(composition, "output.mp4", content = {
    MyComposition()
})

// Non-blocking: returns a RenderJob reporting progress, completion, failure and cancellation
val job: RenderJob = renderer.renderAsync(
    composition = composition,
    outputPath = "output.mp4",
    content = { MyComposition() },
    scope = scope,
)
```

`RenderJob.progress` is a `StateFlow<Int>` of frames rendered so far; `RenderJob.isComplete` and `RenderJob.error` report completion and failure; `RenderJob.cancel()` aborts the render. `FfmpegFrameRenderer` throws `FfmpegNotFoundException` if FFmpeg is not on `PATH` (or at `ffmpegPath`).

## Migration from 0.4.x

The changes below are the complete set of breaking changes since 0.4.0. The published 0.4.1 still has the 0.4.x API; the new API described here is not yet published and will ship as 0.5.0.

### `interpolate` family: range-based to keyframe-based

The `interpolate` family was rewritten from a two-point range API to a multi-keyframe API. The `easing` parameter became `InterpolateOptions`, which adds extrapolation modes and posterization:

| 0.4.x | Now |
|-------|-----|
| `interpolate(frame, IntRange, ClosedFloatingPointRange<Float>, easing: Easing)` | `interpolate(input, List<Int>, List<Float>, options: InterpolateOptions)` |
| `interpolateInt(frame, IntRange, IntRange, easing: Easing)` | `interpolateInt(input, List<Int>, List<Int>, options: InterpolateOptions)` |
| `interpolateColor(frame, IntRange, Color, Color, easing: Easing)` | `interpolateColor(input, List<Int>, List<Color>, options: InterpolateOptions)` |
| `interpolateDp(frame, IntRange, Dp, Dp, easing: Easing)` | `interpolateDp(input, List<Int>, List<Dp>, options: InterpolateOptions)` |

A single easing now applies to every segment; one easing per segment is passed as a list. Extrapolation behavior is controlled per side with `ExtrapolateMode` (`clamp`, `extend`, `wrap`, `identity`); `clamp` is the default, matching the old behavior.

```kotlin
// 0.4.x
val opacity = interpolate(frame, 0..30, 0f..1f, easing = spring())

// Now
val opacity = interpolate(frame, listOf(0, 30), listOf(0f, 1f), options = InterpolateOptions(easing = listOf(spring())))
```

Convenience overloads keep the two-point range form compiling unchanged:

```kotlin
interpolate(frame, 0..30, 0f..1f)  // still valid — delegates to the keyframe form
```

New: `interpolateFloats` for multi-component `FloatArray` output.

### `animate*AsFrame` composables removed

The composable wrappers `animateFloatAsFrame`, `animateIntAsFrame`, `animateColorAsFrame` and `animateDpAsFrame` are gone. Read the frame once with `currentFrame()` and call the pure `interpolate` family:

```kotlin
// 0.4.x
val opacity = animateFloatAsFrame(0..30, 0f..1f)
val count = animateIntAsFrame(0..60, 0..100)
val bg = animateColorAsFrame(0..30, Color.Black, Color.White)
val padding = animateDpAsFrame(0..30, 0.dp, 16.dp)

// Now
val frame = currentFrame()
val opacity = interpolate(frame, 0..30, 0f..1f)
val count = interpolateInt(frame, 0..60, 0..100)
val bg = interpolateColor(frame, 0..30, Color.Black, Color.White)
val padding = interpolateDp(frame, 0..30, 0.dp, 16.dp)
```

### `Sequence` timing model

`Sequence` gained full timing control. `durationInFrames` is now optional (`Int?`) — `null` runs the sequence until the parent ends — and new parameters were added:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `durationInFrames` | `null` | Window length in child frames; `null` = until the parent ends |
| `trimBefore` | `0` | Children start that many child frames early (negative frames, clamped by interpolation) |
| `playbackRate` | `1.0` | Scales child frames; the window becomes `durationInFrames / playbackRate` parent frames long |
| `freeze` | `null` | Pins the child to one frame while the sequence is mounted |
| `loop` | `false` | Repeats the trimmed range until the parent ends (requires finite `durationInFrames`) |
| `name` | `null` | Carried via `LocalSequenceName` for timeline display |

Existing `Sequence(from, durationInFrames)` call sites compile unchanged; the new parameters all have defaults.

### Spring API

`SpringEasing` is now constructed from a `SpringConfig` data class instead of taking `damping`/`stiffness`/`mass` directly, so `SpringEasing(0.3f)` no longer compiles. Use the `spring()` factory, which accepts either individual parameters or a `SpringConfig`:

```kotlin
// 0.4.x
val easing = SpringEasing(damping = 0.3f)
val easing = spring(damping = 0.3f)   // also valid in 0.4.x

// Now
val config = SpringConfig(damping = 0.3f)
val easing = spring(config)
val easing = spring(damping = 0.3f)   // still valid
```

New: `springValue` and `measureSpring`, sharing the same solver as `spring` so the easing curve and the value function never disagree.

### New experimental primitives

`Series`, `TransitionSeries` (with `Fade`, `Slide`, `Wipe`, `Iris`, `ClockWipe`), `Freeze` and `Loop` are new since 0.4.0 and are marked `@ExperimentalKomotionApi` — use them with `@OptIn(ExperimentalKomotionApi::class)`.

### Module layout

No published module was renamed or removed since 0.4.0; the Maven coordinates in [Installation](#installation) are unchanged. `komotion-core` now also hosts the timing primitives (`Sequence`, `Series`, `Freeze`, `Loop`, `TransitionSeries`) and the spring utilities, and `@ExperimentalKomotionApi` is a new opt-in annotation in `komotion-core`.

## Requirements

- Kotlin 2.4.21+
- Compose Multiplatform 1.12.2+
- JVM target 17
- FFmpeg on PATH (for MP4 export)

## Installation

### Gradle (Maven Central)

The current published version is `0.4.1`.

```kotlin
// build.gradle.kts
commonMain.dependencies {
    implementation("dev.boling.komotion:komotion-core:0.4.1")
    implementation("dev.boling.komotion:komotion-player:0.4.1")
    implementation("dev.boling.komotion:komotion-theme:0.4.1")
    implementation("dev.boling.komotion:komotion-algo-viz:0.4.1")
}

// Desktop only
val desktopMain by getting {
    dependencies {
        implementation("dev.boling.komotion:komotion-export-desktop:0.4.1")
    }
}
```

### Gradle (composite build — for local development)

In your `settings.gradle.kts`:

```kotlin
includeBuild("/path/to/komotion") {
    dependencySubstitution {
        substitute(module("dev.boling.komotion:komotion-core")).using(project(":komotion-core"))
        substitute(module("dev.boling.komotion:komotion-player")).using(project(":komotion-player"))
        substitute(module("dev.boling.komotion:komotion-theme")).using(project(":komotion-theme"))
        substitute(module("dev.boling.komotion:komotion-algo-viz")).using(project(":komotion-algo-viz"))
        substitute(module("dev.boling.komotion:komotion-export-desktop")).using(project(":komotion-export-desktop"))
    }
}
```

## Sample app

The `sample-app` module is a player sandbox with demo compositions (FadeIn, TitleCard, BarChart, Loop, Freeze, Transition) and an MP4 export button. Run the desktop build:

```sh
./gradlew :sample-app:run
```

## Releasing

Releases are published to Maven Central by the `Publish to Maven Central` GitHub workflow when a `v*` tag is pushed. See [RELEASING.md](RELEASING.md) for prerequisites, the release checklist and the human approval gates.

## License

    Copyright 2026 Stewart Boling

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
