# Export Performance: Pipe-First Parallel Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential PNG-to-disk export pipeline with raw pixel piping to FFmpeg and parallel frame rendering, achieving 3-5x export speedup while preserving the existing PNG path as a fallback.

**Architecture:** Workers (2-8 `OffscreenRenderer` instances) render frames in parallel and feed them through a bounded channel into an ordered reorder buffer. A single writer coroutine drains the buffer in frame order into FFmpeg's stdin pipe (`-f rawvideo`). The existing PNG-to-disk path is preserved behind a `RenderMode` enum.

**Tech Stack:** Kotlin Coroutines (`Channel`, `Dispatchers.Default`), Skia (`peekPixels`), FFmpeg (`rawvideo` pipe input), `TreeMap` (frame reordering)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/RenderMode.kt` | Create | `RenderMode` enum (`Pipe`, `PngSequence`) |
| `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/OffscreenRenderer.kt` | Modify | Add `renderFrameRaw()` method |
| `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/FfmpegFrameRenderer.kt` | Modify | Add parallel pipe rendering, `renderMode`/`workerCount` params, pipe FFmpeg command builder |
| `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/OffscreenRendererTest.kt` | Modify | Add `renderFrameRaw` test |
| `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt` | Modify | Add pipe command tests, integration test for pipe mode |

---

### Task 1: Add `RenderMode` enum

**Files:**
- Create: `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/RenderMode.kt`

- [ ] **Step 1: Create `RenderMode.kt`**

```kotlin
package dev.boling.komotion.export

/**
 * Controls how frames are delivered to FFmpeg during export.
 */
enum class RenderMode {
    /** Pipe raw BGRA pixels to FFmpeg stdin — fast, no intermediate files. */
    Pipe,
    /** Write PNG frames to a temp directory, then encode — useful for debugging. */
    PngSequence,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `./gradlew :komotion-export-desktop:compileKotlinDesktop`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/RenderMode.kt
git commit -m "feat(export): add RenderMode enum (Pipe, PngSequence)"
```

---

### Task 2: Add `renderFrameRaw()` to `OffscreenRenderer`

**Files:**
- Modify: `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/OffscreenRenderer.kt`
- Modify: `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/OffscreenRendererTest.kt`

- [ ] **Step 1: Write the failing test**

Add to `OffscreenRendererTest.kt`:

```kotlin
@Test
fun `renderFrameRaw returns BGRA bytes with correct size`() = runBlocking {
    val composition = Composition(width = 100, height = 100, durationInFrames = 1, fps = 30)
    val content: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(Color.Red))
    }
    val renderer = OffscreenRenderer(composition)
    val rawBytes = renderer.use { it.renderFrameRaw(frame = 0, content = content) }
    // BGRA = 4 bytes per pixel
    val expectedSize = 100 * 100 * 4
    assertEquals(expectedSize, rawBytes.size, "Raw BGRA bytes should be width * height * 4")
}
```

Add import at top of file:

```kotlin
import kotlin.test.assertEquals
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew :komotion-export-desktop:desktopTest --tests "dev.boling.komotion.export.OffscreenRendererTest.renderFrameRaw returns BGRA bytes with correct size"`
Expected: FAIL — `renderFrameRaw` does not exist

- [ ] **Step 3: Implement `renderFrameRaw`**

Add to `OffscreenRenderer.kt`, after the existing `renderFrame` method (after line 48):

```kotlin
/**
 * Renders [content] at [frame] and returns raw BGRA pixel bytes.
 * Skips PNG encoding — faster than [renderFrame] for piped output.
 */
fun renderFrameRaw(frame: Int, content: @Composable () -> Unit): ByteArray {
    setRenderMode(true)
    currentContent = content
    frameState.value = frame
    val nanoTime = frame * 1_000_000_000L / composition.fps
    val image = scene.render(nanoTime)
    return image.peekPixels()!!.buffer.bytes
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./gradlew :komotion-export-desktop:desktopTest --tests "dev.boling.komotion.export.OffscreenRendererTest"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/OffscreenRenderer.kt \
       komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/OffscreenRendererTest.kt
git commit -m "feat(export): add renderFrameRaw() for raw BGRA pixel output"
```

---

### Task 3: Add pipe-mode FFmpeg command builder

**Files:**
- Modify: `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/FfmpegFrameRenderer.kt`
- Modify: `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt`

- [ ] **Step 1: Write failing tests for pipe-mode command**

Add to `FfmpegFrameRendererTest.kt`:

```kotlin
@Test
fun `buildPipeFfmpegCommand without audio produces rawvideo input args`() {
    val renderer = FfmpegFrameRenderer(renderMode = RenderMode.Pipe)
    val composition = Composition(1080, 1920, 300, 30)
    val command = renderer.buildPipeFfmpegCommand(
        ffmpeg = "ffmpeg",
        composition = composition,
        outputPath = "/tmp/out.mp4",
        audioTracks = emptyList(),
    )

    // rawvideo input from pipe
    assertTrue(command.contains("-f"))
    assertTrue(command.contains("rawvideo"))
    assertTrue(command.contains("-pix_fmt"))
    assertTrue(command.contains("bgra"))
    assertTrue(command.contains("-s"))
    assertTrue(command.contains("1080x1920"))
    assertTrue(command.contains("pipe:0"))
    // No filter_complex without audio
    assertTrue(!command.contains("-filter_complex"))
}

@Test
fun `buildPipeFfmpegCommand with audio includes filter_complex`() {
    val renderer = FfmpegFrameRenderer(renderMode = RenderMode.Pipe)
    val composition = Composition(1080, 1920, 300, 30)
    val tracks = listOf(
        AudioTrack(file = "/audio/hook.wav", startFrame = 0),
        AudioTrack(file = "/audio/demo.wav", startFrame = 90),
    )
    val command = renderer.buildPipeFfmpegCommand(
        ffmpeg = "ffmpeg",
        composition = composition,
        outputPath = "/tmp/out.mp4",
        audioTracks = tracks,
    )

    // rawvideo pipe input
    assertTrue(command.contains("pipe:0"))
    assertTrue(command.contains("rawvideo"))

    // Audio inputs
    assertTrue(command.contains("/audio/hook.wav"))
    assertTrue(command.contains("/audio/demo.wav"))

    // filter_complex
    val filterIndex = command.indexOf("-filter_complex")
    assertTrue(filterIndex >= 0)
    val filter = command[filterIndex + 1]
    assertTrue(filter.contains("adelay=0|0"))
    assertTrue(filter.contains("adelay=3000|3000"))
    assertTrue(filter.contains("amix=inputs=2"))

    // Mapping
    assertTrue(command.contains("0:v"))
    assertTrue(command.contains("[aout]"))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew :komotion-export-desktop:desktopTest --tests "dev.boling.komotion.export.FfmpegFrameRendererTest"`
Expected: FAIL — `buildPipeFfmpegCommand` does not exist, `renderMode` param does not exist

- [ ] **Step 3: Add `renderMode` and `workerCount` constructor params and `buildPipeFfmpegCommand`**

In `FfmpegFrameRenderer.kt`, update the class declaration and add the helper:

```kotlin
class FfmpegFrameRenderer(
    val ffmpegPath: String? = null,
    val crf: Int = 18,
    val preset: FfmpegPreset = FfmpegPreset.Medium,
    val renderMode: RenderMode = RenderMode.Pipe,
    val workerCount: Int = defaultWorkerCount(),
) : FrameRenderer {
```

Add `defaultWorkerCount()` as a top-level private function at the bottom of the file (after the class closing brace):

```kotlin
private fun defaultWorkerCount(): Int =
    (Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 8)
```

Add `buildPipeFfmpegCommand` inside the class, after `buildFfmpegCommand`:

```kotlin
internal fun buildPipeFfmpegCommand(
    ffmpeg: String,
    composition: Composition,
    outputPath: String,
    audioTracks: List<AudioTrack>,
): List<String> {
    val args = mutableListOf(
        ffmpeg, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgra",
        "-s", "${composition.width}x${composition.height}",
        "-r", composition.fps.toString(),
        "-i", "pipe:0",
    )

    // Add each audio file as an input
    for (track in audioTracks) {
        args += listOf("-i", track.file)
    }

    if (audioTracks.isNotEmpty()) {
        val filterParts = mutableListOf<String>()
        val mixInputs = mutableListOf<String>()

        for ((index, track) in audioTracks.withIndex()) {
            val inputIndex = index + 1
            val delayMs = track.startFrame * 1000L / composition.fps
            val label = "a$index"
            filterParts += "[$inputIndex:a]adelay=$delayMs|$delayMs[$label]"
            mixInputs += "[$label]"
        }

        val mixFilter = "${mixInputs.joinToString("")}amix=inputs=${audioTracks.size}:duration=longest:dropout_transition=0:normalize=0[aout]"
        val filterComplex = (filterParts + mixFilter).joinToString(";")

        args += listOf("-filter_complex", filterComplex)
        args += listOf("-map", "0:v", "-map", "[aout]")
    }

    args += listOf(
        "-vcodec", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", crf.toString(),
        "-preset", preset.toFfmpegArg(),
    )

    args += File(outputPath).absolutePath

    return args
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew :komotion-export-desktop:desktopTest --tests "dev.boling.komotion.export.FfmpegFrameRendererTest"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/FfmpegFrameRenderer.kt \
       komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt
git commit -m "feat(export): add pipe-mode FFmpeg command builder and constructor params"
```

---

### Task 4: Implement parallel pipe rendering in `render()`

**Files:**
- Modify: `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/FfmpegFrameRenderer.kt`

- [ ] **Step 1: Add coroutines Channel import**

Add these imports at the top of `FfmpegFrameRenderer.kt`:

```kotlin
import kotlinx.coroutines.channels.Channel
import java.util.TreeMap
```

- [ ] **Step 2: Implement `renderPiped` method**

Add this method inside `FfmpegFrameRenderer`, after `buildPipeFfmpegCommand`:

```kotlin
private suspend fun renderPiped(
    composition: Composition,
    outputPath: String,
    content: @Composable () -> Unit,
    audioTracks: List<AudioTrack>,
    onProgress: (framesRendered: Int) -> Unit,
) {
    val ffmpeg = resolveFfmpeg()
    val command = buildPipeFfmpegCommand(ffmpeg, composition, outputPath, audioTracks)

    val process = withContext(Dispatchers.IO) {
        ProcessBuilder(command)
            .redirectErrorStream(true)
            .start()
    }

    val totalFrames = composition.durationInFrames
    val channel = Channel<Pair<Int, ByteArray>>(capacity = workerCount * 2)

    try {
        coroutineScope {
            // Worker coroutines: each owns its own OffscreenRenderer
            val workers = (0 until workerCount).map { workerId ->
                launch(Dispatchers.Default) {
                    val renderer = OffscreenRenderer(composition)
                    try {
                        var frame = workerId
                        while (frame < totalFrames) {
                            val bytes = renderer.renderFrameRaw(frame, content)
                            channel.send(Pair(frame, bytes))
                            frame += workerCount
                            yield()
                        }
                    } finally {
                        renderer.close()
                    }
                }
            }

            // Writer coroutine: reorders frames and pipes to FFmpeg
            val writer = launch(Dispatchers.IO) {
                val reorderBuffer = TreeMap<Int, ByteArray>()
                var nextFrame = 0
                val outputStream = process.outputStream

                try {
                    for ((frameNum, bytes) in channel) {
                        reorderBuffer[frameNum] = bytes
                        while (reorderBuffer.containsKey(nextFrame)) {
                            outputStream.write(reorderBuffer.remove(nextFrame)!!)
                            onProgress(nextFrame + 1)
                            nextFrame++
                        }
                    }
                    // Flush any remaining frames after channel closes
                    while (reorderBuffer.isNotEmpty()) {
                        val entry = reorderBuffer.pollFirstEntry()
                        outputStream.write(entry.value)
                        onProgress(entry.key + 1)
                    }
                } finally {
                    outputStream.close()
                }
            }

            // Wait for all workers to finish, then close the channel
            workers.forEach { it.join() }
            channel.close()

            // Wait for writer to drain
            writer.join()
        }

        // Wait for FFmpeg to finish
        val exitCode = withContext(Dispatchers.IO) { process.waitFor() }
        if (exitCode != 0) {
            val output = withContext(Dispatchers.IO) {
                process.inputStream.bufferedReader().readText()
            }
            throw IllegalStateException("FFmpeg failed (exit $exitCode):\n$output")
        }
    } catch (e: Throwable) {
        withContext(Dispatchers.IO) { process.destroyForcibly() }
        throw e
    }
}
```

- [ ] **Step 3: Update `render()` to dispatch by mode**

Replace the existing `render()` method body with:

```kotlin
override suspend fun render(
    composition: Composition,
    outputPath: String,
    content: @Composable () -> Unit,
    audioTracks: List<AudioTrack>,
    onProgress: (framesRendered: Int) -> Unit,
) {
    when (renderMode) {
        RenderMode.Pipe -> renderPiped(composition, outputPath, content, audioTracks, onProgress)
        RenderMode.PngSequence -> renderPngSequence(composition, outputPath, content, audioTracks, onProgress)
    }
}
```

- [ ] **Step 4: Rename old render logic to `renderPngSequence`**

Extract the original render body into a private method:

```kotlin
private suspend fun renderPngSequence(
    composition: Composition,
    outputPath: String,
    content: @Composable () -> Unit,
    audioTracks: List<AudioTrack>,
    onProgress: (framesRendered: Int) -> Unit,
) {
    val ffmpeg = resolveFfmpeg()
    val tempDir = withContext(Dispatchers.IO) {
        Files.createTempDirectory("komotion-").toFile()
    }
    val renderer = OffscreenRenderer(composition)
    try {
        for (frame in 0 until composition.durationInFrames) {
            val pngBytes = renderer.renderFrame(frame, content)
            withContext(Dispatchers.IO) {
                File(tempDir, "frame%05d.png".format(frame)).writeBytes(pngBytes)
            }
            onProgress(frame + 1)
            yield()
        }
        withContext(Dispatchers.IO) {
            invokeFfmpeg(ffmpeg, tempDir, composition, outputPath, audioTracks)
        }
    } finally {
        renderer.close()
        withContext(Dispatchers.IO) { tempDir.deleteRecursively() }
    }
}
```

- [ ] **Step 5: Verify compilation**

Run: `./gradlew :komotion-export-desktop:compileKotlinDesktop`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/FfmpegFrameRenderer.kt
git commit -m "feat(export): implement parallel pipe rendering with ordered frame buffer"
```

---

### Task 5: Integration tests for pipe mode

**Files:**
- Modify: `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt`

- [ ] **Step 1: Write integration test for pipe mode**

Add to `FfmpegFrameRendererTest.kt`:

```kotlin
@Test
fun `renders composition to mp4 via pipe mode`() {
    val ffmpegAvailable = try {
        ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
    } catch (e: Exception) { false }
    if (!ffmpegAvailable) {
        println("Skipping: FFmpeg not found on PATH")
        return
    }

    val outputFile = File.createTempFile("komotion-pipe-test-", ".mp4")
    outputFile.deleteOnExit()

    val composition = Composition(width = 320, height = 240, durationInFrames = 10, fps = 30)
    val content: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(Color.Blue))
    }

    runBlocking {
        withContext(Dispatchers.Main) {
            val renderer = FfmpegFrameRenderer(renderMode = RenderMode.Pipe, workerCount = 2)
            renderer.render(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = content,
            )
        }
    }

    assertTrue(outputFile.exists(), "MP4 file should exist")
    assertTrue(outputFile.length() > 0, "MP4 file should not be empty")
}
```

- [ ] **Step 2: Write integration test for PngSequence mode (regression)**

Add to `FfmpegFrameRendererTest.kt`:

```kotlin
@Test
fun `renders composition to mp4 via PngSequence mode`() {
    val ffmpegAvailable = try {
        ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
    } catch (e: Exception) { false }
    if (!ffmpegAvailable) {
        println("Skipping: FFmpeg not found on PATH")
        return
    }

    val outputFile = File.createTempFile("komotion-png-test-", ".mp4")
    outputFile.deleteOnExit()

    val composition = Composition(width = 320, height = 240, durationInFrames = 10, fps = 30)
    val content: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(Color.Green))
    }

    runBlocking {
        withContext(Dispatchers.Main) {
            val renderer = FfmpegFrameRenderer(renderMode = RenderMode.PngSequence)
            renderer.render(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = content,
            )
        }
    }

    assertTrue(outputFile.exists(), "MP4 file should exist")
    assertTrue(outputFile.length() > 0, "MP4 file should not be empty")
}
```

- [ ] **Step 3: Write progress reporting test**

Add to `FfmpegFrameRendererTest.kt`:

```kotlin
@Test
fun `pipe mode reports correct progress`() {
    val ffmpegAvailable = try {
        ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
    } catch (e: Exception) { false }
    if (!ffmpegAvailable) {
        println("Skipping: FFmpeg not found on PATH")
        return
    }

    val outputFile = File.createTempFile("komotion-progress-test-", ".mp4")
    outputFile.deleteOnExit()

    val composition = Composition(width = 320, height = 240, durationInFrames = 10, fps = 30)
    val content: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(Color.Red))
    }

    val progressValues = mutableListOf<Int>()

    runBlocking {
        withContext(Dispatchers.Main) {
            val renderer = FfmpegFrameRenderer(renderMode = RenderMode.Pipe, workerCount = 2)
            renderer.render(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = content,
                onProgress = { progressValues.add(it) },
            )
        }
    }

    // Should have reported progress for all 10 frames
    assertEquals(10, progressValues.size, "Should report progress for each frame")
    // Last progress value should equal total frames
    assertEquals(10, progressValues.last(), "Final progress should equal total frames")
    // Progress should be monotonically increasing
    for (i in 1 until progressValues.size) {
        assertTrue(progressValues[i] > progressValues[i - 1], "Progress should be monotonically increasing")
    }
}
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew :komotion-export-desktop:desktopTest`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt
git commit -m "test(export): add integration tests for pipe mode, PngSequence regression, and progress reporting"
```

---

### Task 6: Update existing integration test to cover default mode

**Files:**
- Modify: `komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt`

- [ ] **Step 1: Update the original integration test comment**

The existing `renders composition to mp4 file` test uses `FfmpegFrameRenderer()` with no args. Since the default is now `RenderMode.Pipe`, this test implicitly covers pipe mode. Rename it for clarity:

Replace:
```kotlin
@Test
fun `renders composition to mp4 file`() {
```
With:
```kotlin
@Test
fun `renders composition to mp4 with default settings`() {
```

- [ ] **Step 2: Run all tests**

Run: `./gradlew :komotion-export-desktop:desktopTest`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add komotion-export-desktop/src/desktopTest/kotlin/dev/boling/komotion/export/FfmpegFrameRendererTest.kt
git commit -m "refactor(test): rename default integration test for clarity"
```

---

### Task 7: Update `RenderJob` doc comment

**Files:**
- Modify: `komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/RenderJob.kt`

- [ ] **Step 1: Update the cancel doc comment**

The `cancel()` doc mentions "temp PNG directory" which is only true for `PngSequence` mode. Update line 24-26 of `RenderJob.kt`:

Replace:
```kotlin
/**
 * Cancels the render. The render coroutine's finally block deletes the
 * temp PNG directory — no partial frames are left on disk.
 */
```
With:
```kotlin
/**
 * Cancels the render. Worker coroutines and the FFmpeg process are
 * torn down cleanly. In PngSequence mode, the temp directory is deleted.
 */
```

- [ ] **Step 2: Run all tests to ensure nothing broke**

Run: `./gradlew :komotion-export-desktop:desktopTest`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add komotion-export-desktop/src/desktopMain/kotlin/dev/boling/komotion/export/RenderJob.kt
git commit -m "docs(export): update RenderJob.cancel() doc for pipe mode"
```

---

### Task 8: Final validation

- [ ] **Step 1: Run full project test suite**

Run: `./gradlew test`
Expected: All tests PASS across all modules

- [ ] **Step 2: Run the sample app export (manual smoke test)**

Run: `./gradlew :sample-app:run`
Expected: Sample app launches, export produces a valid MP4 using the new pipe mode by default

- [ ] **Step 3: Final commit (if any fixups needed)**

If any fixes were needed during validation:
```bash
git add -A
git commit -m "fix(export): fixups from final validation"
```
