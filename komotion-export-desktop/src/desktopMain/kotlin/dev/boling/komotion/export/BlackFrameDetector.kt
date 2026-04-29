package dev.boling.komotion.export

import java.io.File

/**
 * One stretch of consecutive black frames detected in a rendered video.
 * Times are in seconds from the start of the file.
 */
data class BlackInterval(val startSec: Double, val endSec: Double, val durationSec: Double)

/**
 * Thrown by [BlackFrameDetector.assertNoBlackFrames] when QC finds black
 * stretches that exceed the allowed budget. Carries the offending intervals so
 * the caller can log them or fail a build with a useful message.
 */
class BlackFrameQcException(
    message: String,
    val intervals: List<BlackInterval>,
) : IllegalStateException(message)

/**
 * Inspects a rendered MP4 for black stretches using FFmpeg's `blackdetect`
 * filter. The library used to surface this as a separate pass after rendering;
 * wiring it into the pipeline (see [FfmpegFrameRenderer.qc]) means a busted
 * render fails immediately instead of being noticed later.
 */
class BlackFrameDetector(
    private val ffmpegPath: String? = null,
    /** Minimum length of a black run to report, in seconds. */
    val minDurationSec: Double = 0.05,
    /** Pixel-luminance threshold (0..1) below which a pixel counts as black. */
    val pixelThreshold: Double = 0.10,
    /** Per-frame ratio (0..1) of "black" pixels needed to count the frame as black. */
    val pictureRatio: Double = 0.98,
) {

    /**
     * Returns every black interval detected in [videoPath]. The list is empty
     * when the file is clean.
     */
    fun detect(videoPath: String): List<BlackInterval> {
        val ffmpeg = ffmpegPath ?: "ffmpeg"
        val file = File(videoPath)
        require(file.isFile) { "video file does not exist: $videoPath" }

        val cmd = listOf(
            ffmpeg, "-nostats", "-hide_banner",
            "-i", file.absolutePath,
            "-vf", "blackdetect=d=$minDurationSec:pix_th=$pixelThreshold:pic_th=$pictureRatio",
            "-an", "-f", "null", "-",
        )
        val process = ProcessBuilder(cmd).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        val exitCode = process.waitFor()
        if (exitCode != 0) {
            throw IllegalStateException("ffmpeg blackdetect failed (exit $exitCode):\n$output")
        }
        return parseBlackdetect(output)
    }

    /**
     * Detects black intervals and throws [BlackFrameQcException] if the total
     * black duration exceeds [allowedTotalSec]. Use this to gate a CI step or
     * the end of [FfmpegFrameRenderer.render].
     */
    fun assertNoBlackFrames(videoPath: String, allowedTotalSec: Double = 0.0) {
        val intervals = detect(videoPath)
        val total = intervals.sumOf { it.durationSec }
        if (total > allowedTotalSec) {
            val summary = intervals.joinToString("\n  ") {
                "  ${"%.3f".format(it.startSec)}s -> ${"%.3f".format(it.endSec)}s (${"%.3f".format(it.durationSec)}s)"
            }
            throw BlackFrameQcException(
                "Black-frame QC failed for $videoPath: ${"%.3f".format(total)}s of black exceeds budget ${"%.3f".format(allowedTotalSec)}s.\n$summary",
                intervals,
            )
        }
    }

    internal fun parseBlackdetect(ffmpegOutput: String): List<BlackInterval> {
        // Lines look like:
        // [blackdetect @ 0x...] black_start:1.234 black_end:2.345 black_duration:1.111
        val regex = Regex("""black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)""")
        return regex.findAll(ffmpegOutput).map {
            BlackInterval(
                startSec = it.groupValues[1].toDouble(),
                endSec = it.groupValues[2].toDouble(),
                durationSec = it.groupValues[3].toDouble(),
            )
        }.toList()
    }
}
