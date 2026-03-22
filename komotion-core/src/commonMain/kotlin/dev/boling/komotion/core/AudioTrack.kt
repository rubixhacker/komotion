package dev.boling.komotion.core

/**
 * Declares an audio file to be mixed into the rendered output.
 *
 * Audio tracks are passed to [FrameRenderer.render] — they are NOT composable.
 * The renderer is responsible for mixing them at the correct timing during export.
 *
 * @param file Absolute or relative path to an audio file (WAV, MP3, AAC, etc.)
 * @param startFrame The frame at which this audio begins playing.
 */
data class AudioTrack(
    val file: String,
    val startFrame: Int = 0,
)
