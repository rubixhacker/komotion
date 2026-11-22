# Komotion

Frame-driven video animation for Compose Multiplatform.

Komotion lets you build video compositions as `@Composable` functions where every animation is a pure function of the current frame number. This makes animations deterministic, scrubbable, and trivially exportable to MP4.

Think [Remotion](https://www.remotion.dev/) — but for Kotlin and Compose.

<p align="center">
  <img src="docs/demo.gif" alt="Komotion TitleCard demo" width="480">
</p>

## Modules

| Module | Targets | Description |
|--------|---------|-------------|
| `komotion-core` | Android, iOS, Desktop, wasmJs | Core API: `Composition`, `Sequence`, `interpolate`, `spring`, `LocalFrame` |
| `komotion-player` | Android, iOS, Desktop, wasmJs | Embedded player with play/pause, scrub, loop, and frame counter |
| `komotion-export-desktop` | Desktop (JVM) | MP4 export via FFmpeg with audio mixing and video frame extraction |
| `komotion-theme` | Android, iOS, Desktop, wasmJs | Shared design tokens: `KomotionTheme` with colors, typography and shapes |
| `komotion-algo-viz` | Android, iOS, Desktop, wasmJs | Algorithm visualizations for arrays, graphs, trees, stacks and queues |

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
    renderer.render(composition, "output.mp4") {
        HelloVideo()
    }
}
```

## Core API

### Frame & Composition

Every composable in a Komotion composition reads the current frame with `currentFrame()`:

```kotlin
val frame = currentFrame()                  // 0-based frame index
val comp = LocalComposition.current         // width, height, fps, durationInFrames
```

### Sequence

Time-window a section of your composition. Children see `LocalFrame` offset to 0-based within the sequence:

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

### Interpolation

Pure functions — deterministic, no Compose context needed. Every animated value is
`currentFrame()` piped through one of these:

```kotlin
interpolate(frame, 0..30, 0f..1f)                           // Float
interpolateInt(frame, 0..60, 0..100)                         // Int
interpolateColor(frame, 0..30, Color.Black, Color.White)     // Color
interpolateDp(frame, 0..30, 0.dp, 16.dp)                    // Dp
```

The keyframe form accepts lists of equal length (at least one element), so a single
call can drive a multi-segment animation:

```kotlin
interpolate(frame, listOf(0, 30, 60), listOf(0f, 1f, 0f))
```

Behavior is controlled with `InterpolateOptions`:

```kotlin
InterpolateOptions(
    extrapolateLeft = ExtrapolateMode.clamp,   // clamp | extend | wrap | identity
    extrapolateRight = ExtrapolateMode.clamp, // clamp is the default
    posterize = 3,                            // quantize the input to a step (e.g. 3 = 10 fps at 30 fps)
    easing = listOf(LinearEasing),            // one easing, or one per segment
)
```

`interpolateFloats(frame, listOf(0, 20), listOf(floatArrayOf(0f, 0f), floatArrayOf(100f, 50f)))`
interpolates every component of a `FloatArray` independently.

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

### Audio Tracks

Declare audio files to be mixed into the exported MP4:

```kotlin
val audioTracks = listOf(
    AudioTrack(file = "/path/to/intro.wav", startFrame = 0),
    AudioTrack(file = "/path/to/main.wav", startFrame = 90),
)

renderer.render(composition, "output.mp4", audioTracks = audioTracks) {
    MyComposition()
}
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
