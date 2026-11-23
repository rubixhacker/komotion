package dev.boling.komotion.export

import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.media.AudioMedia

/**
 * A low-level audio input for the FFmpeg filter graph: a file plus timing and
 * mixing parameters. [AudioTrack] is the public export representation;
 * collected [AudioMedia] declarations are converted to this form.
 */
internal data class AudioInput(
    val file: String,
    val startFrame: Int,
    val volume: Float = 1f,
    val playbackRate: Float = 1f,
    val trimStartFrame: Int = 0,
    val trimEndFrame: Int? = null,
    val muted: Boolean = false,
) {
    companion object {
        fun from(track: AudioTrack) = AudioInput(file = track.file, startFrame = track.startFrame)

        fun from(media: AudioMedia) = AudioInput(
            file = media.file,
            startFrame = media.startFrame,
            volume = media.volume,
            playbackRate = media.playbackRate,
            trimStartFrame = media.trimStartFrame,
            trimEndFrame = media.trimEndFrame,
            muted = media.muted,
        )
    }
}
