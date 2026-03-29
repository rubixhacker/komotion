# Export Performance: Pipe-First Parallel Rendering

**Date:** 2026-03-29
**Status:** Approved

## Problem

The current export pipeline has three cost centers:

1. **Sequential frame rendering** — frames are independent but rendered one at a time
2. **PNG encoding per frame** — lossless PNG compression is slow; adds ~50-70% overhead per frame
3. **Disk round-trip** — PNGs written to temp dir, then re-read by FFmpeg

For a 60s video at 30fps (1800 frames), these compound into significant export times.

## Solution

Replace the default export path with raw pixel piping to FFmpeg and parallel frame rendering across multiple worker scenes. Retain the current PNG-to-disk path as a fallback.

## Design

### Render Modes

```kotlin
enum class RenderMode {
    /** Pipe raw pixels to FFmpeg stdin — fast, no intermediate files */
    Pipe,
    /** Write PNG frames to temp dir, then encode — useful for debugging */
    PngSequence,
}
```

Default is `Pipe`. `PngSequence` preserves the current behavior.

### Constructor Changes

```kotlin
class FfmpegFrameRenderer(
    val ffmpegPath: String? = null,
    val crf: Int = 18,
    val preset: FfmpegPreset = FfmpegPreset.Medium,
    val renderMode: RenderMode = RenderMode.Pipe,
    val workerCount: Int = defaultWorkerCount(),
)
```

`defaultWorkerCount()` returns `(Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 8)`.

Existing code using `FfmpegFrameRenderer()` with no args gets the fast path automatically. To opt into the old behavior: `FfmpegFrameRenderer(renderMode = RenderMode.PngSequence)`.

### Parallel Frame Rendering

**Workers:** Each worker owns its own `OffscreenRenderer` (which owns an `ImageComposeScene`). Workers are spawned as coroutines on `Dispatchers.Default`.

**Frame assignment:** Striped partitioning — worker 0 gets frames 0, N, 2N...; worker 1 gets 1, N+1, 2N+1... This avoids contention and ensures even distribution.

**Ordered output buffer:** A `Channel<Pair<Int, ByteArray>>` bounded to `workerCount * 2` slots. Workers render and place `(frameNumber, pixelBytes)` into the channel. A dedicated writer coroutine reads from a reorder buffer (`TreeMap<Int, ByteArray>`) and writes frames to the FFmpeg pipe strictly in order.

```
Workers (N scenes)          Ordered Buffer           FFmpeg stdin
  +- W0: frame 0,4,8... -+
  +- W1: frame 1,5,9... --+---> Channel ---> TreeMap ---> raw BGRA pipe
  +- W2: frame 2,6,10.. --+    (bounded)    (reorder)
  +- W3: frame 3,7,11.. -+
```

**Backpressure:** The bounded channel blocks workers when the writer falls behind, preventing unbounded memory growth. With `workerCount * 2` capacity, workers can stay ~2 frames ahead.

**Lifecycle:**

1. Spawn FFmpeg process with raw pixel input args
2. Launch N worker coroutines
3. Launch 1 writer coroutine draining channel to pipe
4. Workers complete -> channel closes -> writer flushes remaining -> pipe closes
5. Wait for FFmpeg exit
6. All `OffscreenRenderer` instances closed in `finally`

### FFmpeg Pipe Input

For `RenderMode.Pipe`, FFmpeg is launched before rendering starts with stdin as the pixel source:

```
ffmpeg -y \
  -f rawvideo -pix_fmt bgra -s {width}x{height} -r {fps} \
  -i pipe:0 \
  [audio inputs + filter_complex if audioTracks present] \
  -vcodec libx264 -pix_fmt yuv420p -crf {crf} -preset {preset} \
  {outputPath}
```

- **Pixel format:** `bgra` — native output of Skia's `ImageComposeScene.render()`. No conversion needed on our side; FFmpeg handles `bgra -> yuv420p`.
- **Frame data:** `image.peekPixels()!!.buffer.bytes` to get raw BGRA bytes, skipping PNG compression.
- **Error handling:** FFmpeg's stderr captured async. Non-zero exit includes error output in the exception.

For `RenderMode.PngSequence`, existing behavior is unchanged.

### OffscreenRenderer Changes

New method alongside the existing `renderFrame`:

```kotlin
/** Returns raw BGRA pixel bytes — no PNG encoding overhead. */
fun renderFrameRaw(frame: Int, content: @Composable () -> Unit): ByteArray {
    setRenderMode(true)
    currentContent = content
    frameState.value = frame
    val nanoTime = frame * 1_000_000_000L / composition.fps
    val image = scene.render(nanoTime)
    return image.peekPixels()!!.buffer.bytes
}
```

The existing `renderFrame` (PNG) stays untouched for `PngSequence` mode.

**Thread safety:** `ImageComposeScene` is not thread-safe. Each worker gets its own `OffscreenRenderer` instance. No shared mutable state between workers.

**`close()` contract:** Each worker closes its own renderer in a `finally` block.

### Progress Reporting & Cancellation

**Progress:** The writer coroutine increments progress each time it writes a frame to the pipe. Same `onProgress(framesRendered)` callback, same `StateFlow<Int>` in `RenderJob`. No public API change.

**Cancellation:** On `job.cancel()`:

1. Worker coroutines check `yield()` between frames — they exit promptly
2. Channel closes, writer drains and exits
3. FFmpeg's stdin pipe closes -> FFmpeg terminates naturally
4. `finally` blocks close all renderers and `process.destroyForcibly()` if needed

**Error propagation:** Worker exceptions propagate via `coroutineScope {}` structured concurrency — all siblings are cancelled, writer exits, FFmpeg is torn down, error surfaces through `RenderJob.error`.

## Public API Surface

No breaking changes. Additions only:

- `RenderMode` enum (`Pipe`, `PngSequence`)
- `FfmpegFrameRenderer` constructor params: `renderMode` (default `Pipe`), `workerCount` (default auto)
- `OffscreenRenderer.renderFrameRaw()` method

## Testing

- **Unit:** `buildFfmpegCommand` tests updated for both modes (pipe adds `-f rawvideo -pix_fmt bgra -s WxH -i pipe:0`)
- **Integration:** Render a short 10-frame composition via both modes, verify valid MP4 output
- **Raw render:** Verify `renderFrameRaw` byte array length equals `width * height * 4` (BGRA)
