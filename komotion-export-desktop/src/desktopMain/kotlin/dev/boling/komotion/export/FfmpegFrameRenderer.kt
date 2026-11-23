package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.FrameRenderer
import dev.boling.komotion.media.AudioMedia
import dev.boling.komotion.media.LocalMediaCollector
import dev.boling.komotion.media.MediaCollector
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
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
    val renderMode: RenderMode = RenderMode.Pipe,
    val workerCount: Int = defaultWorkerCount(),
) : FrameRenderer {

    override suspend fun render(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        onProgress: (framesRendered: Int) -> Unit,
    ) {
        render(composition, outputPath, content, audioTracks, null, onProgress)
    }

    internal suspend fun render(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        mediaCollector: MediaCollector?,
        onProgress: (framesRendered: Int) -> Unit,
    ) {
        val collector = mediaCollector ?: MediaCollector()
        when (renderMode) {
            RenderMode.Pipe -> renderPiped(composition, outputPath, content, audioTracks, collector, onProgress)
            RenderMode.PngSequence -> renderPngSequence(composition, outputPath, content, audioTracks, collector, onProgress)
        }
    }

    private suspend fun renderPiped(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        collector: MediaCollector,
        onProgress: (framesRendered: Int) -> Unit,
    ) {
        val ffmpeg = resolveFfmpeg()
        val totalFrames = composition.durationInFrames
        val contentWithCollector = provideCollector(content, collector)

        // Pre-scan pass: compose every frame so the collector accumulates media
        // declared in any sequence window before the FFmpeg command is built.
        val renderer = OffscreenRenderer(composition)
        try {
            for (frame in 0 until totalFrames) {
                collector.frame = frame
                renderer.renderFrameRaw(frame, contentWithCollector)
                yield()
            }
        } finally {
            renderer.close()
        }

        val command = buildPipeFfmpegCommandWithInputs(ffmpeg, composition, outputPath, toAudioInputs(audioTracks, collector))

        val process = withContext(Dispatchers.IO) {
            ProcessBuilder(command)
                .redirectErrorStream(true)
                .start()
        }

        val channel = Channel<Pair<Int, ByteArray>>(capacity = workerCount * 2)

        try {
            coroutineScope {
                // Renderer runs on the calling coroutine's thread (typically Dispatchers.Main).
                // ImageComposeScene (Skiko) requires a stable, consistent thread context; using
                // a single renderer here avoids multi-scene GL state conflicts that occur when
                // multiple OffscreenRenderer instances are created across different thread pools.
                val renderJob = launch {
                    val renderer = OffscreenRenderer(composition)
                    try {
                        for (frame in 0 until totalFrames) {
                            collector.frame = frame
                            val bytes = renderer.renderFrameRaw(frame, contentWithCollector)
                            channel.send(Pair(frame, bytes))
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
                        for ((frameNum, bytes) in channel) {
                            outputStream.write(bytes)
                            onProgress(frameNum + 1)
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
            val exitCode = withContext(Dispatchers.IO) { process.waitFor() }
            if (exitCode != 0) {
                throw IllegalStateException("FFmpeg failed (exit $exitCode)")
            }
        } finally {
            withContext(Dispatchers.IO) {
                process.inputStream.close()
                process.outputStream.close()
                process.errorStream.close()
                process.destroyForcibly()
            }
        }
    }

    private suspend fun renderPngSequence(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack>,
        collector: MediaCollector,
        onProgress: (framesRendered: Int) -> Unit,
    ) {
        val ffmpeg = resolveFfmpeg()
        val tempDir = withContext(Dispatchers.IO) {
            Files.createTempDirectory("komotion-").toFile()
        }
        val renderer = OffscreenRenderer(composition)
        val contentWithCollector = provideCollector(content, collector)
        try {
            for (frame in 0 until composition.durationInFrames) {
                collector.frame = frame
                val pngBytes = renderer.renderFrame(frame, contentWithCollector)
                withContext(Dispatchers.IO) {
                    File(tempDir, "frame%05d.png".format(frame)).writeBytes(pngBytes)
                }
                onProgress(frame + 1)
                yield()
            }
            withContext(Dispatchers.IO) {
                invokeFfmpeg(ffmpeg, tempDir, composition, outputPath, toAudioInputs(audioTracks, collector))
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
        mediaCollector: MediaCollector? = null,
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
                    mediaCollector = mediaCollector,
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
        audioInputs: List<AudioInput>,
    ) {
        val command = buildFfmpegCommandWithInputs(ffmpeg, composition, outputPath, audioInputs)
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
        return buildFfmpegCommandWithInputs(ffmpeg, composition, outputPath, audioTracks.map { AudioInput.from(it) })
    }

    internal fun buildFfmpegCommandWithInputs(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioInputs: List<AudioInput>,
    ): List<String> {
        val args = mutableListOf(
            ffmpeg, "-y",
            "-r", composition.fps.toString(),
            "-i", "frame%05d.png",
        )

        // Add each audio file as an input
        for (input in audioInputs) {
            args += listOf("-i", input.file)
        }

        // Build filter_complex: trim, rate, delay each audio input to its start
        // frame, apply volume, then mix
        val (filterComplex, mapArgs) = buildAudioFilter(composition.fps, audioInputs)
        if (filterComplex != null) {
            args += listOf("-filter_complex", filterComplex)
            args += mapArgs
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

    internal fun buildPipeFfmpegCommand(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioTracks: List<AudioTrack>,
    ): List<String> {
        return buildPipeFfmpegCommandWithInputs(ffmpeg, composition, outputPath, audioTracks.map { AudioInput.from(it) })
    }

    internal fun buildPipeFfmpegCommandWithInputs(
        ffmpeg: String,
        composition: Composition,
        outputPath: String,
        audioInputs: List<AudioInput>,
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
        for (input in audioInputs) {
            args += listOf("-i", input.file)
        }

        val (filterComplex, mapArgs) = buildAudioFilter(composition.fps, audioInputs)
        if (filterComplex != null) {
            args += listOf("-filter_complex", filterComplex)
            args += mapArgs
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

    /**
     * Builds the FFmpeg audio filter graph for [audioInputs].
     *
     * Each input is trimmed (atrim), rate-adjusted (atempo), delayed to its
     * start frame (adelay) and volume-adjusted (volume), then all inputs are
     * mixed with amix. Returns null when there are no audio inputs.
     */
    private fun buildAudioFilter(
        fps: Int,
        audioInputs: List<AudioInput>,
    ): Pair<String?, List<String>> {
        if (audioInputs.isEmpty()) return null to emptyList()

        val filterParts = mutableListOf<String>()
        val mixInputs = mutableListOf<String>()

        for ((index, input) in audioInputs.withIndex()) {
            val inputIndex = index + 1 // 0 is the video frames
            val label = "a$index"
            val parts = mutableListOf<String>()

            if (input.trimStartFrame > 0 || input.trimEndFrame != null) {
                val end = input.trimEndFrame?.let { ":end=${it / fps.toDouble()}" } ?: ""
                parts += "atrim=start=${input.trimStartFrame / fps.toDouble()}$end"
                // atrim keeps the file's timestamps; reset them so adelay alone
                // determines when the audio starts on the global timeline.
                parts += "asetpts=PTS-STARTPTS"
            }
            if (input.playbackRate != 1f) {
                parts += "atempo=${input.playbackRate}"
            }
            val delayMs = input.startFrame * 1000L / fps
            parts += "adelay=$delayMs|$delayMs"
            if (input.muted || input.volume != 1f) {
                parts += "volume=${if (input.muted) 0f else input.volume}"
            }

            filterParts += "[$inputIndex:a]${parts.joinToString(";")}[$label]"
            mixInputs += "[$label]"
        }

        val mixFilter = "${mixInputs.joinToString("")}amix=inputs=${audioInputs.size}:duration=longest:dropout_transition=0:normalize=0[aout]"
        val filterComplex = (filterParts + mixFilter).joinToString(";")

        return filterComplex to listOf("-map", "0:v", "-map", "[aout]")
    }

    /** Combines explicitly passed [audioTracks] with audio collected from the composition. */
    private fun toAudioInputs(audioTracks: List<AudioTrack>, collector: MediaCollector): List<AudioInput> {
        val collected = collector.snapshot().filterIsInstance<AudioMedia>()
        return audioTracks.map { AudioInput.from(it) } + collected.map { AudioInput.from(it) }
    }

    /** Wraps [content] so media composables register with [collector]. */
    private fun provideCollector(
        content: @Composable () -> Unit,
        collector: MediaCollector,
    ): @Composable () -> Unit = {
        CompositionLocalProvider(LocalMediaCollector provides collector) {
            content()
        }
    }
}

private fun defaultWorkerCount(): Int =
    (Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 8)
