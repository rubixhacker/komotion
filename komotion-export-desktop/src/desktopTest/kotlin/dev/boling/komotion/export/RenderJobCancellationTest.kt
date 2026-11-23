package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RenderJobCancellationTest {

    private fun ffmpegAvailable(): Boolean = try {
        ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
    } catch (e: Exception) {
        false
    }

    @Test
    fun `cancelling a PngSequence render leaves no temp files or FFmpeg processes`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-cancel-seq-", ".mp4")
        outputFile.deleteOnExit()
        val scope = CoroutineScope(Dispatchers.Main)
        val composition = Composition(width = 160, height = 120, durationInFrames = 300, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Red))
        }

        runBlocking {
            val before = komotionTempDirs()
            val job = FfmpegFrameRenderer(renderMode = RenderMode.PngSequence).renderAsync(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = content,
                scope = scope,
            )

            // Let the render start and produce a few frames.
            awaitUntil({ job.progress.value.framesCompleted >= 3 })
            job.cancel()
            assertTrue(awaitUntil({ job.error.value != null }), "error should be reported after cancel")

            // No new temp directories, no FFmpeg process for this output.
            assertEquals(before, komotionTempDirs(), "cancellation should not leave temp directories")
            assertTrue(!ffmpegProcessExists(outputFile), "no FFmpeg process should reference the output")
        }
    }

    @Test
    fun `cancelling a Pipe render leaves no temp files or FFmpeg processes`() {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val outputFile = File.createTempFile("komotion-cancel-pipe-", ".mp4")
        outputFile.deleteOnExit()
        val scope = CoroutineScope(Dispatchers.Main)
        // Pipe mode renders fast (no per-frame PNG encoding), so use a large frame
        // count to guarantee the render is still in progress when we cancel.
        val composition = Composition(width = 160, height = 120, durationInFrames = 10_000, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Red))
        }

        runBlocking {
            val before = komotionTempDirs()
            val job = FfmpegFrameRenderer(renderMode = RenderMode.Pipe, workerCount = 2).renderAsync(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = content,
                scope = scope,
            )

            // Let the render start and produce a few frames.
            awaitUntil({ job.progress.value.framesCompleted >= 3 })
            job.cancel()
            assertTrue(awaitUntil({ job.error.value != null }), "error should be reported after cancel")

            assertEquals(before, komotionTempDirs(), "cancellation should not leave temp directories")
            assertTrue(!ffmpegProcessExists(outputFile), "no FFmpeg process should reference the output")
        }
    }

    /** Waits (up to 30s) for [condition] to become true. */
    private suspend fun awaitUntil(condition: () -> Boolean): Boolean {
        val start = System.currentTimeMillis()
        while (!condition()) {
            if (System.currentTimeMillis() - start > 30_000) return false
            delay(50)
        }
        return true
    }

    private fun komotionTempDirs(): List<String> {
        val root = File(System.getProperty("java.io.tmpdir"))
        return (root.listFiles { f -> f.isDirectory && f.name.startsWith("komotion-") } ?: emptyArray())
            .map { it.name }
            .sorted()
    }

    private fun ffmpegProcessExists(outputFile: File): Boolean {
        val process = try {
            ProcessBuilder("ps", "-ef").redirectErrorStream(true).start()
        } catch (e: Exception) {
            println("Skipping process check: 'ps' is not available in this environment")
            return false
        }
        val output = process.inputStream.bufferedReader().readText()
        process.waitFor()
        return output.lines().any { it.contains("ffmpeg") && it.contains(outputFile.name) }
    }
}
