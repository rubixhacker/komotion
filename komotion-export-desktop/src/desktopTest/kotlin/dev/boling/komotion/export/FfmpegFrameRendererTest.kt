package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Composition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FfmpegFrameRendererTest {

    @Test
    fun `buildFfmpegCommand without audio produces video-only args`() {
        val renderer = FfmpegFrameRenderer()
        val composition = Composition(1080, 1920, 300, 30)
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
        )

        assertTrue(command.contains("-r"))
        assertTrue(command.contains("30"))
        assertTrue(command.contains("frame%05d.png"))
        assertTrue(command.contains("-vcodec"))
        assertTrue(!command.contains("-filter_complex"))
        assertTrue(!command.contains("-map"))
    }

    @Test
    fun `buildFfmpegCommand with audio tracks includes filter_complex and inputs`() {
        val renderer = FfmpegFrameRenderer()
        val composition = Composition(1080, 1920, 300, 30)
        val tracks = listOf(
            AudioTrack(file = "/audio/hook.wav", startFrame = 0),
            AudioTrack(file = "/audio/demo.wav", startFrame = 90),
            AudioTrack(file = "/audio/takeaway.wav", startFrame = 210),
        )
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = tracks,
        )

        // Should have 4 -i flags: frames + 3 audio
        val inputFlags = command.indices.filter { command[it] == "-i" }
        assertEquals(4, inputFlags.size)

        // Audio file paths should appear
        assertTrue(command.contains("/audio/hook.wav"))
        assertTrue(command.contains("/audio/demo.wav"))
        assertTrue(command.contains("/audio/takeaway.wav"))

        // Should have filter_complex
        val filterIndex = command.indexOf("-filter_complex")
        assertTrue(filterIndex >= 0)
        val filter = command[filterIndex + 1]

        // hook.wav starts at frame 0 → 0ms delay
        assertTrue(filter.contains("adelay=0|0"))
        // demo.wav starts at frame 90 → 3000ms delay
        assertTrue(filter.contains("adelay=3000|3000"))
        // takeaway.wav starts at frame 210 → 7000ms delay
        assertTrue(filter.contains("adelay=7000|7000"))
        // amix with 3 inputs
        assertTrue(filter.contains("amix=inputs=3"))

        // Should map video and audio
        assertTrue(command.contains("-map"))
        assertTrue(command.contains("0:v"))
        assertTrue(command.contains("[aout]"))
    }

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

    @Test
    fun `renders composition to mp4 file`() {
        val ffmpegAvailable = try {
            ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
        } catch (e: Exception) { false }
        if (!ffmpegAvailable) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-test-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 320, height = 240, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Blue))
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                val renderer = FfmpegFrameRenderer()
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
}
