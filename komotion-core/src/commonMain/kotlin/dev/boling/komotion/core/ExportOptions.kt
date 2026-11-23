package dev.boling.komotion.core

/**
 * A range of frames to render.
 *
 * @property start The first frame (inclusive).
 * @property end The last frame (inclusive). `null` means the range runs to the end of the composition.
 */
data class FrameRange(
    val start: Int,
    val end: Int? = null,
) {
    /** A single frame. */
    companion object {
        fun of(frame: Int) = FrameRange(frame, frame)
    }
}

/**
 * The video codec used when encoding.
 *
 * @property args For [Custom], the encoder arguments to append verbatim in place of
 * the built-in encoder arguments (e.g. `listOf("-vcodec", "libx265", "-crf", "30")`).
 */
sealed class Codec {
    /** H.264 (the default). */
    data object H264 : Codec()

    /** H.265 / HEVC. */
    data object H265 : Codec()

    /** Custom encoder arguments, appended verbatim. */
    data class Custom(val args: List<String>) : Codec()
}

/**
 * Options for [FrameRenderer.render].
 *
 * @property frameRange The frames to render: ordered, non-overlapping ranges that are
 * concatenated in list order. A single frame is `listOf(FrameRange.of(n))`, a range is
 * `listOf(FrameRange(a, b))`, and an open-ended range (`FrameRange(a)`) runs to the end
 * of the composition. The default `listOf(FrameRange(0))` renders the whole composition.
 * @property scale Multiplier for the output dimensions (e.g. `0.5` renders half-size).
 * The composition is rendered at full resolution and the output is scaled
 * proportionally.
 * @property codec The video codec to encode with.
 * @property muted Drops the audio from the output. Takes precedence over
 * [separateAudioTo].
 * @property separateAudioTo Writes the mixed audio to this file instead of muxing it
 * into the video. The container is chosen from the file extension (`.m4a`, `.wav`,
 * `.mp3`, `.aac`). Ignored when [muted] is true or there are no audio tracks.
 * @property metadata Metadata to embed in the output (e.g. `mapOf("title" to "…")`).
 */
data class ExportOptions(
    val frameRange: List<FrameRange> = listOf(FrameRange(0)),
    val scale: Double = 1.0,
    val codec: Codec = Codec.H264,
    val muted: Boolean = false,
    val separateAudioTo: String? = null,
    val metadata: Map<String, String> = emptyMap(),
)
