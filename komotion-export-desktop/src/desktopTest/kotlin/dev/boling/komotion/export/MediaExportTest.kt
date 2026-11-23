package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import dev.boling.komotion.media.Audio
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MediaExportTest {

    @Test
    fun `buildPipeFfmpegCommand applies volume rate trim and mute filters`() {
        val renderer = FfmpegFrameRenderer(renderMode = RenderMode.Pipe)
        val composition = Composition(width = 320, height = 240, durationInFrames = 100, fps = 30)
        val inputs = listOf(
            AudioInput(
                file = "/a.wav",
                startFrame = 30,
                volume = 0.5f,
                playbackRate = 2f,
                trimStartFrame = 5,
                trimEndFrame = 20,
            ),
            AudioInput(file = "/b.wav", startFrame = 0, muted = true),
        )
        val command = renderer.buildPipeFfmpegCommandWithInputs(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioInputs = inputs,
        )

        val filterIndex = command.indexOf("-filter_complex")
        assertTrue(filterIndex >= 0)
        val filter = command[filterIndex + 1]

        // /a.wav: trim 5..20 frames at 30 fps, 2x rate, start at frame 30 (1000 ms), half volume
        assertTrue(filter.contains("atrim=start=0.16666666666666666:end=0.6666666666666666"), filter)
        assertTrue(filter.contains("atempo=2.0"), filter)
        assertTrue(filter.contains("adelay=1000|1000"), filter)
        assertTrue(filter.contains("volume=0.5"), filter)

        // /b.wav: muted, no delay
        assertTrue(filter.contains("adelay=0|0"), filter)
        assertTrue(filter.contains("volume=0.0"), filter)

        // Mixed with 2 inputs
        assertTrue(filter.contains("amix=inputs=2"), filter)
    }

    @Test
    fun `png sequence export mixes audio declared inside the composition`() =
        assertExportMixesDeclaredAudio(RenderMode.PngSequence)

    @Test
    fun `pipe mode export mixes audio declared inside the composition`() =
        assertExportMixesDeclaredAudio(RenderMode.Pipe)

    /**
     * Exports a composition that declares one [Audio] and verifies the
     * resulting MP4 carries an audio stream.
     */
    private fun assertExportMixesDeclaredAudio(renderMode: RenderMode) {
        if (!ffmpegAvailable()) {
            println("Skipping: FFmpeg not found on PATH")
            return
        }

        val wav = generateTestWav()

        val outputFile = File.createTempFile("komotion-media-$renderMode-", ".mp4")
        outputFile.deleteOnExit()

        val composition = Composition(width = 320, height = 240, durationInFrames = 10, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Black))
            Audio(file = wav.absolutePath)
        }

        runBlocking {
            withContext(Dispatchers.Main) {
                FfmpegFrameRenderer(renderMode = renderMode)
                    .render(
                        composition = composition,
                        outputPath = outputFile.absolutePath,
                        content = content,
                    )
            }
        }

        assertTrue(outputFile.exists(), "MP4 file should exist")
        assertTrue(outputFile.length() > 0, "MP4 file should not be empty")
        assertTrue(hasAudioStream(outputFile), "Expected an audio stream in the exported MP4")
    }

    private fun ffmpegAvailable(): Boolean = try {
        ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
    } catch (e: Exception) {
        false
    }

    /** Generates a one-second 440 Hz sine-wave WAV via FFmpeg. */
    private fun generateTestWav(): File {
        val wav = File.createTempFile("komotion-audio-", ".wav")
        wav.deleteOnExit()
        val exit = ProcessBuilder(
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-ar", "44100", "-ac", "1",
            wav.absolutePath,
        ).redirectErrorStream(true).start().waitFor()
        assertEquals(0, exit, "WAV generation failed")
        return wav
    }

    private fun hasAudioStream(file: File): Boolean {
        val process = ProcessBuilder(
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            file.absolutePath,
        ).redirectErrorStream(true).start()
        val streams = process.inputStream.bufferedReader().readText()
        process.waitFor()
        return streams.contains("audio")
    }
}
