package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.FrameRenderer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.nio.file.Files

enum class FfmpegPreset {
    UltraFast, Fast, Medium, Slow, VerySlow;
    internal fun toFfmpegArg(): String = name.lowercase()
}

class FfmpegNotFoundException(message: String) : Exception(message)

class FfmpegFrameRenderer(
    val ffmpegPath: String? = null,
    val crf: Int = 18,
    val preset: FfmpegPreset = FfmpegPreset.Medium,
) : FrameRenderer {

    override suspend fun render(
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

    fun renderAsync(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        scope: CoroutineScope,
        audioTracks: List<AudioTrack> = emptyList(),
    ): RenderJob {
        val progressFlow = MutableStateFlow(0)
        val isCompleteFlow = MutableStateFlow(false)
        val errorFlow = MutableStateFlow<Throwable?>(null)

        val job = scope.launch(Dispatchers.Main) {
            try {
                render(
                    composition = composition,
                    outputPath = outputPath,
                    content = content,
                    audioTracks = audioTracks,
                    onProgress = { progressFlow.value = it },
                )
                isCompleteFlow.value = true
            } catch (e: Throwable) {
                errorFlow.value = e
            }
        }

        return RenderJob(
            progress = progressFlow.asStateFlow(),
            totalFrames = composition.durationInFrames,
            isComplete = isCompleteFlow.asStateFlow(),
            error = errorFlow.asStateFlow(),
            job = job,
        )
    }

    private fun resolveFfmpeg(): String {
        if (ffmpegPath != null) {
            if (File(ffmpegPath).canExecute()) return ffmpegPath
            throw FfmpegNotFoundException("ffmpeg not found at '$ffmpegPath'")
        }
        return try {
            ProcessBuilder("ffmpeg", "-version")
                .redirectErrorStream(true)
                .start()
                .waitFor()
            "ffmpeg"
        } catch (e: Exception) {
            throw FfmpegNotFoundException(
                "FFmpeg not found on PATH. Install it with:\n" +
                "  macOS:  brew install ffmpeg\n" +
                "  Linux:  sudo apt install ffmpeg\n" +
                "  Windows: https://ffmpeg.org/download.html"
            )
        }
    }

    private fun invokeFfmpeg(
        ffmpeg: String,
        tempDir: File,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack> = emptyList(),
    ) {
        val command = buildFfmpegCommand(ffmpeg, composition, outputPath, audioTracks)
        val process = ProcessBuilder(command)
            .directory(tempDir)
            .redirectErrorStream(true)
            .start()

        val exitCode = process.waitFor()
        if (exitCode != 0) {
            val output = process.inputStream.bufferedReader().readText()
            throw IllegalStateException("FFmpeg failed (exit $exitCode):\n$output")
        }
    }

    internal fun buildFfmpegCommand(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
    ): List<String> {
        val args = mutableListOf(
            ffmpeg, "-y",
            "-r", composition.fps.toString(),
            "-i", "frame%05d.png",
        )

        // Add each audio file as an input
        for (track in audioTracks) {
            args += listOf("-i", track.file)
        }

        if (audioTracks.isNotEmpty()) {
            // Build filter_complex: delay each audio track to its start frame, then mix
            val filterParts = mutableListOf<String>()
            val mixInputs = mutableListOf<String>()

            for ((index, track) in audioTracks.withIndex()) {
                val inputIndex = index + 1 // 0 is the video frames
                val delayMs = track.startFrame * 1000L / composition.fps
                val label = "a$index"
                filterParts += "[$inputIndex:a]adelay=$delayMs|$delayMs[$label]"
                mixInputs += "[$label]"
            }

            val mixFilter = "${mixInputs.joinToString("")}amix=inputs=${audioTracks.size}:duration=longest:dropout_transition=0[aout]"
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

        // Ensure absolute output path
        args += File(outputPath).absolutePath

        return args
    }
}
