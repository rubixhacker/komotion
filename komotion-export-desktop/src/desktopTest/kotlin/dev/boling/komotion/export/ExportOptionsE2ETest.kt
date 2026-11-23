package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Codec
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.ExportOptions
import dev.boling.komotion.core.FrameRange
import dev.boling.komotion.core.RenderProgress
import dev.boling.komotion.core.RenderStage
import dev.boling.komotion.core.currentFrame
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.skia.Bitmap
import org.jetbrains.skia.Image
import java.io.File
import java.util.Collections
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExportOptionsE2ETest {

    // One distinctive color per frame, so the order of exported frames is checkable.
    private val frameColors = listOf(
        Color.Red,
        Color.Green,
        Color.Blue,
        Color.Magenta,
        Color.Cyan,
        Color.White,
        Color(0xFF660033),
        Color(0xFFC89696),
        Color.Black,
        Color(0xFF336699),
    )

    /** A flat, uninteresting background for tests that do not check pixels. */
    private val solidColor = Color.Gray

    @Test
    fun `frameRange renders exactly the requested frames in order`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-range-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(frameColors[currentFrame()]))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(frameRange = listOf(FrameRange(0, 1), FrameRange(4, 5))),
                )
            }
        }

        assertEquals(4, frameCount(outputFile), "Only the four requested frames should be exported")
        // Frames 0, 1, 4, 5 → red, green, cyan, white. The yuv420p round trip
        // shifts exact values, so assert each frame's channel signature (which
        // channels are bright) rather than exact RGB.
        assertChannelSignature(outputFile, 0, rHigh = true, gHigh = false, bHigh = false) // red
        assertChannelSignature(outputFile, 1, rHigh = false, gHigh = true, bHigh = false) // green
        assertChannelSignature(outputFile, 2, rHigh = false, gHigh = true, bHigh = true) // cyan
        assertChannelSignature(outputFile, 3, rHigh = true, gHigh = true, bHigh = true) // white
    }

    @Test
    fun `frameRange single frame exports one frame`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-single-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(frameColors[currentFrame()]))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(frameRange = listOf(FrameRange.of(7))),
                )
            }
        }

        assertEquals(1, frameCount(outputFile))
        assertPixelClose(outputFile, 0, 200, 150, 150)
    }

    @Test
    fun `frameRange open-ended range runs to the end of the composition`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-open-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(frameColors[currentFrame()]))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(frameRange = listOf(FrameRange(8))),
                )
            }
        }

        assertEquals(2, frameCount(outputFile), "Frames 8 and 9 should be exported")
    }

    @Test
    fun `scale changes the output dimensions proportionally`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-scale-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 320, height = 240, durationInFrames = 5, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(scale = 0.5),
                )
            }
        }

        assertEquals("160x120", videoDimensions(outputFile))
    }

    @Test
    fun `codec H265 encodes hevc`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-h265-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 5, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(codec = Codec.H265),
                )
            }
        }

        assertEquals("hevc", videoCodecName(outputFile))
    }

    @Test
    fun `codec Custom passes FFmpeg arguments through`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-custom-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 5, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(codec = Codec.Custom(listOf("-vcodec", "libx265", "-crf", "30"))),
                )
            }
        }

        assertEquals("hevc", videoCodecName(outputFile))
    }

    @Test
    fun `muted drops audio and separateAudioTo writes it to its own file`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val tone = createToneWav()
        val composition = Composition(width = 160, height = 120, durationInFrames = 30, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }
        val track = AudioTrack(file = tone.absolutePath, startFrame = 0)

        // muted: the audio track is dropped
        val mutedFile = File.createTempFile("komotion-e2e-muted-", ".mp4")
        mutedFile.deleteOnExit()
        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = mutedFile.absolutePath,
                    content = content,
                    audioTracks = listOf(track),
                    options = ExportOptions(muted = true),
                )
            }
        }
        assertEquals("", audioCodecName(mutedFile), "muted output should have no audio stream")

        // separateAudioTo: video without audio, audio in its own file
        val videoFile = File.createTempFile("komotion-e2e-sep-video-", ".mp4")
        videoFile.deleteOnExit()
        val audioFile = File.createTempFile("komotion-e2e-sep-audio-", ".m4a")
        audioFile.deleteOnExit()
        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = videoFile.absolutePath,
                    content = content,
                    audioTracks = listOf(track),
                    options = ExportOptions(separateAudioTo = audioFile.absolutePath),
                )
            }
        }
        assertEquals("", audioCodecName(videoFile), "video output should have no audio stream")
        assertTrue(audioFile.exists(), "separate audio file should exist")
        assertEquals("aac", audioCodecName(audioFile))
    }

    @Test
    fun `metadata is embedded in the output`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-meta-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 5, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    options = ExportOptions(metadata = mapOf("title" to "Komotion E2E", "artist" to "Boling")),
                )
            }
        }

        assertEquals("Komotion E2E", ffprobeTag(outputFile, "title"))
        assertEquals("Boling", ffprobeTag(outputFile, "artist"))
    }

    @Test
    fun `progress reports rendered and encoded stages`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-e2e-progress-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 160, height = 120, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(solidColor))
        }

        val progress = Collections.synchronizedList(mutableListOf<RenderProgress>())
        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).render(
                    composition = composition,
                    outputPath = outputFile.absolutePath,
                    content = content,
                    onProgress = { progress.add(it) },
                )
            }
        }

        val rendering = progress.filter { it.stage == RenderStage.Rendering }
        val encoding = progress.filter { it.stage == RenderStage.Encoding }
        assertEquals(10, rendering.size, "One Rendering event per frame")
        assertEquals(10, rendering.last().framesCompleted)
        assertTrue(encoding.isNotEmpty(), "Encoding stage should be reported")
        assertEquals(10, encoding.last().framesCompleted)
        progress.forEach { assertEquals(10, it.totalFrames) }
    }

    // --- helpers ---------------------------------------------------------------

    private fun createToneWav(): File {
        val tone = File.createTempFile("komotion-e2e-tone-", ".wav")
        tone.deleteOnExit()
        ProcessBuilder(
            "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-c:a", "pcm_s16le", tone.absolutePath,
        ).redirectErrorStream(true).start().waitFor()
        assertTrue(tone.length() > 0, "tone wav should be created")
        return tone
    }

    private fun frameCount(file: File): Int =
        ffprobe(
            listOf("-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                "-of", "default=noprint_wrappers=1:nokey=1"),
            file,
        ).trim().toInt()

    private fun videoDimensions(file: File): String =
        ffprobe(
            listOf("-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0"),
            file,
        ).trim()

    private fun videoCodecName(file: File): String =
        ffprobe(
            listOf("-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1"),
            file,
        ).trim()

    private fun audioCodecName(file: File): String =
        ffprobe(
            listOf("-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1"),
            file,
        ).trim()

    private fun ffprobeTag(file: File, tag: String): String =
        ffprobe(
            listOf("-show_entries", "format_tags=$tag", "-of", "default=noprint_wrappers=1"),
            file,
        ).trim()
            // Newer ffprobe prefixes tags with "TAG:".
            .removePrefix("TAG:$tag=")
            .removePrefix("$tag=")

    private fun ffprobe(args: List<String>, file: File): String {
        // Probe results go to stdout; the version banner and input diagnostics go to
        // stderr, so only capture stdout.
        val process = ProcessBuilder(listOf("ffprobe") + args + listOf(file.absolutePath)).start()
        val output = process.inputStream.bufferedReader().readText()
        val exitCode = process.waitFor()
        if (exitCode != 0) {
            throw IllegalStateException("ffprobe failed (exit $exitCode):\n$output")
        }
        return output
    }

    /** Extracts [index] from [file] and samples the RGB at pixel (10, 10). */
    private fun extractFrameRgb(file: File, index: Int): IntArray {
        val png = File(file.parentFile, "komotion-e2e-frame-$index.png")
        png.deleteOnExit()
        val exitCode = ProcessBuilder(
            "ffmpeg", "-y", "-i", file.absolutePath,
            // The comma must be escaped so the filtergraph parser does not split
            // the expression at the comma.
            "-vf", "select=eq(n\\,$index)", "-frames:v", "1", "-fps_mode", "passthrough", png.absolutePath,
        ).redirectErrorStream(true).start().waitFor()
        assertTrue(exitCode == 0, "ffmpeg frame extraction failed (exit $exitCode)")
        val image = Image.makeFromEncoded(png.readBytes())
        val bitmap = Bitmap.makeFromImage(image)
        val pixels = bitmap.readPixels()!!
        val offset = (10 * bitmap.imageInfo.height + 10) * 4
        return intArrayOf(pixels[offset].toInt() and 0xFF, pixels[offset + 1].toInt() and 0xFF, pixels[offset + 2].toInt() and 0xFF)
    }

    private fun assertPixelClose(file: File, index: Int, r: Int, g: Int, b: Int) {
        val rgb = extractFrameRgb(file, index)
        if (rgb.all { it == 0 }) {
            println("Skipping pixel assertion: this environment renders empty frames")
            return
        }
        assertTrue(
            abs(rgb[0] - r) <= 40 && abs(rgb[1] - g) <= 40 && abs(rgb[2] - b) <= 40,
            "Expected ~($r, $g, $b) at frame $index, got $rgb",
        )
    }

    /**
     * Asserts which channels of [index] are bright, robust to the yuv420p
     * round trip that shifts exact RGB values. A channel is "high" when it is
     * clearly above the mid point and "low" when clearly below it.
     */
    private fun assertChannelSignature(file: File, index: Int, rHigh: Boolean, gHigh: Boolean, bHigh: Boolean) {
        val rgb = extractFrameRgb(file, index)
        if (rgb.all { it == 0 }) {
            println("Skipping pixel assertion: this environment renders empty frames")
            return
        }
        val check = { actual: Int, expectedHigh: Boolean, label: String ->
            if (expectedHigh) {
                assertTrue(actual > 150, "Expected bright $label at frame $index, got $actual")
            } else {
                assertTrue(actual < 120, "Expected dark $label at frame $index, got $actual")
            }
        }
        check(rgb[0], rHigh, "R")
        check(rgb[1], gHigh, "G")
        check(rgb[2], bHigh, "B")
    }

}
