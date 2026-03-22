package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.Image
import java.io.File
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap

/**
 * Extracts individual frames from an MP4 video file using FFmpeg.
 *
 * Frames are cached in memory after first extraction. Create one extractor
 * per video file and [close] it when done.
 */
class VideoFrameExtractor(
    private val videoFile: String,
    private val ffmpegPath: String? = null,
) : AutoCloseable {

    private val frameCache = ConcurrentHashMap<Int, ImageBitmap>()

    /**
     * Extracts frame [frameIndex] from the video and returns it as an [ImageBitmap].
     *
     * @param frameIndex Zero-based frame index within the video file.
     * @param fps Frame rate of the video (used to compute seek time). Defaults to 30.
     * @return The extracted frame, or null if extraction fails.
     */
    fun extractFrame(frameIndex: Int, fps: Int = 30): ImageBitmap? {
        frameCache[frameIndex]?.let { return it }

        val ffmpeg = ffmpegPath ?: "ffmpeg"
        val timestamp = frameIndex.toDouble() / fps

        val tempFile = Files.createTempFile("komotion-vframe-", ".png").toFile()
        try {
            val process = ProcessBuilder(
                ffmpeg, "-y",
                "-ss", "%.6f".format(timestamp),
                "-i", videoFile,
                "-frames:v", "1",
                "-f", "image2",
                tempFile.absolutePath,
            )
                .redirectErrorStream(true)
                .start()

            val exitCode = process.waitFor()
            if (exitCode != 0) return null

            val pngBytes = tempFile.readBytes()
            if (pngBytes.isEmpty()) return null

            val bitmap = Image.makeFromEncoded(pngBytes).toComposeImageBitmap()
            frameCache[frameIndex] = bitmap
            return bitmap
        } finally {
            tempFile.delete()
        }
    }

    override fun close() {
        frameCache.clear()
    }
}

/**
 * Tracks whether the current composition is being rendered offscreen (export mode).
 *
 * When true, [rememberVideoFrame] will extract real frames from the video.
 * When false (preview), it returns null so callers can show a placeholder.
 */
private val isRenderMode = ThreadLocal.withInitial { false }

/**
 * Sets render mode for the current thread. Called by [OffscreenRenderer] before
 * rendering frames so that [rememberVideoFrame] knows to extract real frames.
 */
internal fun setRenderMode(enabled: Boolean) {
    isRenderMode.set(enabled)
}

/**
 * Returns true if the current thread is in render mode (offscreen export).
 */
fun isInRenderMode(): Boolean = isRenderMode.get()

/**
 * Remembers a [VideoFrameExtractor] for [videoFile], extracting frame [frameIndex].
 *
 * In render mode (during export), returns the actual decoded frame as [ImageBitmap].
 * In preview mode, returns null — callers should show a placeholder.
 *
 * @param videoFile Absolute path to the MP4 file.
 * @param frameIndex Zero-based frame index within the video file.
 * @param fps Frame rate of the source video. Defaults to 30.
 */
@Composable
fun rememberVideoFrame(
    videoFile: String,
    frameIndex: Int,
    fps: Int = 30,
): ImageBitmap? {
    if (!isInRenderMode()) return null

    val extractor = remember(videoFile) { VideoFrameExtractor(videoFile) }
    return extractor.extractFrame(frameIndex, fps)
}
