package dev.boling.komotion.media

/**
 * A piece of media declared inside a composition.
 *
 * Declarations are collected by a [MediaCollector] while the composition is
 * composed, so preview and export consume the same declarations instead of a
 * side-channel list.
 *
 * [startFrame] is on the composition's global timeline: a declaration made
 * inside a [dev.boling.komotion.core.Sequence] is shifted by the sequence's
 * offset when it is registered.
 */
sealed interface Media {
    /** Absolute or relative path to the media file. */
    val file: String

    /** Frame at which this media starts on the global timeline. */
    val startFrame: Int
}

/** An audio file to be mixed into the exported output. */
data class AudioMedia(
    override val file: String,
    override val startFrame: Int = 0,
    /** Volume multiplier: 0f = silent, 1f = full volume. */
    val volume: Float = 1f,
    /** Playback rate: 1f = normal speed, 2f = twice as fast. */
    val playbackRate: Float = 1f,
    /** Frames skipped at the beginning of the file. */
    val trimStartFrame: Int = 0,
    /** Frame position in the file where the audio ends; null = play to the end. */
    val trimEndFrame: Int? = null,
    /** Whether the audio is muted. */
    val muted: Boolean = false,
) : Media

/** A video file to be embedded in the composition. */
data class VideoMedia(
    override val file: String,
    override val startFrame: Int = 0,
) : Media

/** An image file used by the composition. */
data class ImageMedia(
    override val file: String,
    override val startFrame: Int = 0,
) : Media
