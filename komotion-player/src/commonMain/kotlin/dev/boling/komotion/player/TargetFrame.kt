package dev.boling.komotion.player

/**
 * The frame to display after [elapsedMs] of playback at [fps] and
 * [playbackRate], restricted to the window [windowStart]..[windowEnd]
 * (both inclusive) and honoring [loop].
 *
 * With [loop] the window wraps around; otherwise playback stops at
 * [windowEnd].
 */
internal fun targetFrame(
    elapsedMs: Long,
    fps: Int,
    playbackRate: Float,
    windowStart: Int,
    windowEnd: Int,
    loop: Boolean,
): Int {
    require(fps > 0) { "fps must be positive" }
    require(playbackRate > 0f) { "playbackRate must be positive" }
    require(windowStart in 0..windowEnd) { "windowStart must not exceed windowEnd" }
    val windowLength = (windowEnd - windowStart + 1).toLong()
    val elapsedFrames = (elapsedMs.toDouble() * fps * playbackRate / 1000.0).toLong()
    return if (loop) {
        windowStart + (elapsedFrames % windowLength).toInt()
    } else {
        minOf(windowEnd.toLong(), windowStart.toLong() + elapsedFrames).toInt()
    }
}
