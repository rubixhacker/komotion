package dev.boling.komotion.captions

/**
 * A single caption cue: [text] shown from [startFrame] up to, but not including,
 * [endFrame]. Frames are zero-based, matching the composition's frame clock.
 */
data class Caption(
    val text: String,
    val startFrame: Int,
    val endFrame: Int,
)

/**
 * Returns the cue active at [frame], or null if no cue covers the frame.
 *
 * A cue covers [frame] when `startFrame <= frame < endFrame`. If several cues
 * overlap, the first one in the list wins.
 */
fun activeCaptionAt(captions: List<Caption>, frame: Int): Caption? =
    captions.firstOrNull { frame >= it.startFrame && frame < it.endFrame }
