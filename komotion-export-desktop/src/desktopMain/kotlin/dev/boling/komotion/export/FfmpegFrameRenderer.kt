package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Codec
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.ExportOptions
import dev.boling.komotion.core.FrameRange
import dev.boling.komotion.core.FrameRenderer
import dev.boling.komotion.core.RenderProgress
import dev.boling.komotion.core.RenderStage
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.roundToInt

enum class FfmpegPreset {
    UltraFast, Fast, Medium, Slow, VerySlow;
    internal fun toFfmpegArg(): String = name.lowercase()
}

class FfmpegNotFoundException(message: String) : Exception(message)

class FfmpegFrameRenderer(
    val ffmpegPath: String? = null,
    val crf: Int = 18,
    val preset: FfmpegPreset = FfmpegPreset.Medium,
    val renderMode: RenderMode = RenderMode.Pipe,
    val workerCount: Int = defaultWorkerCount(),
) : FrameRenderer {

    override suspend fun render(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        onProgress: (RenderProgress) -> Unit,
        options: ExportOptions,
    ) {
        val frames = expandFrameRange(options.frameRange, composition.durationInFrames)
        require(frames.isNotEmpty()) { "frameRange ${options.frameRange} selects no frames" }
        when (renderMode) {
            RenderMode.Pipe -> renderPiped(composition, outputPath, content, audioTracks, onProgress, options, frames)
            RenderMode.PngSequence -> renderPngSequence(composition, outputPath, content, audioTracks, onProgress, options, frames)
        }
    }

    /**
     * Renders a single frame to an image file directly through Skia, without
     * invoking FFmpeg.
     *
     * The format is chosen from the file extension: `.jpg`/`.jpeg` encodes JPEG,
     * anything else encodes PNG.
     *
     * @return the written file.
     */
    suspend fun renderStill(
        composition: Composition,
        frame: Int,
        outputPath: String,
        content: @Composable () -> Unit,
    ): File {
        require(frame in 0 until composition.durationInFrames) {
            "Frame $frame is outside 0..${composition.durationInFrames - 1}"
        }
        val output = File(outputPath)
        val renderer = OffscreenRenderer(composition)
        try {
            val image = renderer.renderFrameImage(frame, content)
            val format = when (output.extension.lowercase()) {
                "jpg", "jpeg" -> EncodedImageFormat.JPEG
                else -> EncodedImageFormat.PNG
            }
            val bytes = image.encodeToData(format)!!.bytes
            withContext(Dispatchers.IO) {
                output.writeBytes(bytes)
            }
            return output
        } finally {
            renderer.close()
        }
    }

    private suspend fun renderPiped(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        onProgress: (RenderProgress) -> Unit,
        options: ExportOptions,
        frames: List<Int>,
    ) {
        val ffmpeg = resolveFfmpeg()
        val command = buildPipeFfmpegCommand(ffmpeg, composition, outputPath, audioTracks, options)

        val process = ProcessBuilder(command)
            .redirectErrorStream(true)
            .start()

        val totalFrames = frames.size
        val channel = Channel<ByteArray>(capacity = workerCount * 2)

        try {
            coroutineScope {
                // Renderer runs on the calling coroutine's thread (typically Dispatchers.Main).
                // ImageComposeScene (Skiko) requires a stable, consistent thread context; using
                // a single renderer here avoids multi-scene GL state conflicts that occur when
                // multiple OffscreenRenderer instances are created across different thread pools.
                val renderJob = launch {
                    val renderer = OffscreenRenderer(composition)
                    try {
                        for ((index, frame) in frames.withIndex()) {
                            val bytes = renderer.renderFrameRaw(frame, content)
                            channel.send(bytes)
                            onProgress(RenderProgress(RenderStage.Rendering, index + 1, totalFrames))
                            yield()
                        }
                    } finally {
                        renderer.close()
                    }
                }

                // Drain FFmpeg's stdout/stderr to prevent pipe buffer deadlock.
                // With redirectErrorStream(true), all output goes to inputStream —
                // if the buffer fills, FFmpeg blocks and waitFor() hangs.
                val stdoutDrain = launch(Dispatchers.IO) {
                    process.inputStream.bufferedReader().readText()
                }

                // Writer coroutine: pipes frames to FFmpeg in order
                val writer = launch(Dispatchers.IO) {
                    val outputStream = process.outputStream

                    try {
                        var written = 0
                        for (bytes in channel) {
                            outputStream.write(bytes)
                            written++
                            onProgress(RenderProgress(RenderStage.Encoding, written, totalFrames))
                        }
                    } finally {
                        outputStream.close()
                    }
                }

                // Wait for renderer to finish, then close the channel
                renderJob.join()
                channel.close()

                // Wait for writer to drain, then wait for FFmpeg stdout
                writer.join()
                stdoutDrain.join()
            }

            // Wait for FFmpeg to finish
            val exitCode = waitForCancellationAware(process)
            if (exitCode != 0) {
                throw IllegalStateException("FFmpeg failed (exit $exitCode)")
            }
        } finally {
            closeProcess(process)
        }
    }

    private suspend fun renderPngSequence(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        onProgress: (RenderProgress) -> Unit,
        options: ExportOptions,
        frames: List<Int>,
    ) {
        val ffmpeg = resolveFfmpeg()
        val renderer = OffscreenRenderer(composition)
        try {
            val tempDir = withContext(Dispatchers.IO) { Files.createTempDirectory("komotion-").toFile() }
            try {
                for ((index, frame) in frames.withIndex()) {
                    val pngBytes = renderer.renderFrame(frame, content)
                    withContext(Dispatchers.IO) {
                        File(tempDir, "frame%05d.png".format(index)).writeBytes(pngBytes)
                    }
                    onProgress(RenderProgress(RenderStage.Rendering, index + 1, frames.size))
                    yield()
                }
                onProgress(RenderProgress(RenderStage.Encoding, frames.size, frames.size))
                invokeFfmpeg(ffmpeg, tempDir, composition, outputPath, audioTracks, options)
            } finally {
                // NonCancellable: the cleanup must run even when the render was cancelled.
                withContext(NonCancellable) { tempDir.deleteRecursively() }
            }
        } finally {
            renderer.close()
        }
    }

    fun renderAsync(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        scope: CoroutineScope,
        audioTracks: List<AudioTrack> = emptyList(),
        options: ExportOptions = ExportOptions(),
    ): RenderJob {
        val totalFrames = expandFrameRange(options.frameRange, composition.durationInFrames).size
        val progressFlow = MutableStateFlow(RenderProgress(RenderStage.Rendering, 0, totalFrames))
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
                    options = options,
                )
                isCompleteFlow.value = true
            } catch (e: Throwable) {
                errorFlow.value = e
            }
        }

        return RenderJob(
            progress = progressFlow.asStateFlow(),
            totalFrames = totalFrames,
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

    private suspend fun invokeFfmpeg(
        ffmpeg: String,
        tempDir: File,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
        options: ExportOptions,
    ) {
        val command = buildFfmpegCommand(ffmpeg, composition, outputPath, audioTracks, options)
        val process = ProcessBuilder(command)
            .directory(tempDir)
            .redirectErrorStream(true)
            .start()
        try {
            coroutineScope {
                // Drain FFmpeg's stdout/stderr to prevent pipe buffer deadlock.
                val outputRef = AtomicReference<String>()
                val stdoutDrain = launch(Dispatchers.IO) {
                    outputRef.set(process.inputStream.bufferedReader().readText())
                }
                val exitCode = waitForCancellationAware(process)
                stdoutDrain.join()
                if (exitCode != 0) {
                    throw IllegalStateException("FFmpeg failed (exit $exitCode):\n${outputRef.get()}")
                }
            }
        } finally {
            closeProcess(process)
        }
    }

    /**
     * Waits for [process] to exit, checking for cancellation on every poll so the
     * process can be torn down when the render is cancelled.
     */
    private suspend fun waitForCancellationAware(process: Process): Int = withContext(Dispatchers.IO) {
        while (!process.waitFor(100, TimeUnit.MILLISECONDS)) {
            delay(1) // Suspension point: throws if the job was cancelled.
        }
        process.exitValue()
    }

    /**
     * Closes [process]'s streams and destroys it.
     *
     * Runs on [NonCancellable] so the cleanup happens even when the render
     * was cancelled.
     */
    private suspend fun closeProcess(process: Process) {
        withContext(NonCancellable) {
            process.inputStream.close()
            process.outputStream.close()
            process.errorStream.close()
            process.destroyForcibly()
        }
    }

    /**
     * Expands [frameRange] into the exact list of frames to render, in order.
     *
     * Ranges must be ordered and non-overlapping; open-ended ranges run to the end
     * of the composition.
     */
    internal fun expandFrameRange(frameRange: List<FrameRange>, durationInFrames: Int): List<Int> {
        require(durationInFrames > 0) { "durationInFrames must be positive" }
        val frames = mutableListOf<Int>()
        var previousEnd = -1
        for (range in frameRange) {
            val start = range.start
            val end = range.end ?: durationInFrames - 1
            require(start in 0 until durationInFrames) {
                "Frame range $range starts at frame $start, which is outside 0..${durationInFrames - 1}"
            }
            require(end < durationInFrames) {
                "Frame range $range ends at frame $end, which is outside 0..${durationInFrames - 1}"
            }
            require(end >= start) { "Frame range $range is empty" }
            require(start > previousEnd) {
                "Frame ranges must be ordered and non-overlapping: $range follows a range ending at frame $previousEnd"
            }
            frames += (start..end)
            previousEnd = end
        }
        return frames
    }

    internal fun buildFfmpegCommand(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
        options: ExportOptions = ExportOptions(),
    ): List<String> =
        buildCommand(ffmpeg, composition, outputPath, audioTracks, options, piped = false)

    internal fun buildPipeFfmpegCommand(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
        options: ExportOptions = ExportOptions(),
    ): List<String> =
        buildCommand(ffmpeg, composition, outputPath, audioTracks, options, piped = true)

    private fun buildCommand(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
        options: ExportOptions,
        piped: Boolean,
    ): List<String> {
        val args = mutableListOf(ffmpeg, "-y")

        if (piped) {
            args += listOf(
                "-f", "rawvideo",
                "-pix_fmt", "bgra",
                "-s", "${composition.width}x${composition.height}",
            )
        }
        args += listOf("-r", composition.fps.toString(), "-i", if (piped) "pipe:0" else "frame%05d.png")

        val hasAudio = !options.muted && audioTracks.isNotEmpty()
        val separateAudioTo = options.separateAudioTo

        if (hasAudio) {
            // Add each audio file as an input
            for (track in audioTracks) {
                args += listOf("-i", track.file)
            }

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

            val mixFilter = "${mixInputs.joinToString("")}amix=inputs=${audioTracks.size}:duration=longest:dropout_transition=0:normalize=0[aout]"
            val filterComplex = (filterParts + mixFilter).joinToString(";")

            args += listOf("-filter_complex", filterComplex)
        }

        // Scale the output proportionally
        if (options.scale != 1.0) {
            val width = (composition.width * options.scale).roundToInt()
            val height = (composition.height * options.scale).roundToInt()
            require(width > 0 && height > 0) {
                "scale ${options.scale} produces non-positive dimensions"
            }
            args += listOf("-vf", "scale=$width:$height")
        }

        if (hasAudio) {
            args += listOf("-map", "0:v")
            if (separateAudioTo == null) {
                args += listOf("-map", "[aout]")
            }
        }

        when (val codec = options.codec) {
            Codec.H264 -> args += standardCodecArgs("libx264")
            Codec.H265 -> args += standardCodecArgs("libx265")
            is Codec.Custom -> args += codec.args
        }

        for ((key, value) in options.metadata) {
            args += listOf("-metadata", "$key=$value")
        }

        // Ensure absolute output path
        args += File(outputPath).absolutePath

        // Write the mixed audio to a separate file instead of muxing it into the video
        if (hasAudio && separateAudioTo != null) {
            args += listOf("-map", "[aout]")
            args += listOf("-c:a", audioCodecFor(separateAudioTo))
            args += File(separateAudioTo).absolutePath
        }

        return args
    }

    /**
     * The built-in encoder arguments for the standard codecs (H.264, H.265).
     */
    private fun standardCodecArgs(ffmpegCodec: String): List<String> = listOf(
        "-vcodec", ffmpegCodec,
        "-pix_fmt", "yuv420p",
        "-crf", crf.toString(),
        "-preset", preset.toFfmpegArg(),
    )

    /**
     * The FFmpeg audio codec for a separate audio file, chosen from its extension.
     */
    internal fun audioCodecFor(path: String): String = when (File(path).extension.lowercase()) {
        "wav" -> "pcm_s16le"
        "mp3" -> "libmp3lame"
        "aac" -> "adts"
        "m4a", "mp4" -> "aac"
        else -> "aac"
    }
}

private fun defaultWorkerCount(): Int =
    (Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 8)
