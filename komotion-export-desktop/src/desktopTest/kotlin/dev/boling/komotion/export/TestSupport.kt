package dev.boling.komotion.export

/** True if FFmpeg is available on the PATH. */
internal fun ffmpegAvailable(): Boolean = try {
    ProcessBuilder("ffmpeg", "-version").start().waitFor() == 0
} catch (e: Exception) {
    false
}
