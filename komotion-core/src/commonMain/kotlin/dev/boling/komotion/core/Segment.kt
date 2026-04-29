package dev.boling.komotion.core

/**
 * Describes one numbered segment of a multi-section composition.
 *
 * The [index] is the segment's position within its parent composition (0-based).
 * [from] and [durationInFrames] match the semantics of [Sequence].
 */
data class Segment(
    val index: Int,
    val from: Int,
    val durationInFrames: Int,
)

/**
 * Thrown when pre-render validation finds a structural problem that would
 * otherwise produce a silently-broken output (missing audio, mismatched counts,
 * out-of-range segments). Renderers must abort before committing any frames.
 */
class SegmentValidationException(message: String) : IllegalStateException(message)

/**
 * Asserts that every segment in `0 until segmentCount` has an entry in
 * [audioSegments], that there are no extra entries, and that the counts match.
 *
 * This is the pre-render validator. Call it before kicking off the renderer —
 * a mismatch silently produces a video that cuts off mid-segment or has the
 * wrong narration on later segments, which is much harder to debug after the
 * fact than an upfront failure.
 *
 * @throws SegmentValidationException on any mismatch. Message lists the
 * specific missing/extra indices so the caller can fix them directly.
 */
fun validateAudioSegments(segmentCount: Int, audioSegments: Map<Int, AudioTrack>) {
    require(segmentCount >= 0) { "segmentCount must be >= 0, was $segmentCount" }

    val expected = (0 until segmentCount).toSet()
    val actual = audioSegments.keys
    val missing = (expected - actual).sorted()
    val extra = (actual - expected).sorted()

    if (missing.isEmpty() && extra.isEmpty() && audioSegments.size == segmentCount) return

    val details = buildString {
        append("Audio segment count mismatch: expected ")
        append(segmentCount)
        append(" entries, got ")
        append(audioSegments.size)
        append('.')
        if (missing.isNotEmpty()) {
            append("\n  Missing audio for segments: ")
            append(missing)
        }
        if (extra.isNotEmpty()) {
            append("\n  Unexpected audio keys (outside 0 until segmentCount): ")
            append(extra)
        }
        append("\nAborting render — fix the audio map before rendering.")
    }
    throw SegmentValidationException(details)
}

/**
 * Asserts that [segments] cover indices `0 until segmentCount` exactly once,
 * that each segment fits within [composition.durationInFrames], and that
 * [audioSegments] (when non-empty) matches by index.
 *
 * Use this when a composition is described declaratively as a list of segments —
 * it catches the same class of bugs as [validateAudioSegments] plus structural
 * issues with the segment list itself.
 */
fun validateSegments(
    composition: Composition,
    segments: List<Segment>,
    audioSegments: Map<Int, AudioTrack> = emptyMap(),
) {
    val problems = mutableListOf<String>()

    val byIndex = segments.groupBy { it.index }
    val duplicates = byIndex.filter { it.value.size > 1 }.keys.sorted()
    if (duplicates.isNotEmpty()) problems += "Duplicate segment indices: $duplicates"

    val expected = (0 until segments.size).toSet()
    val missing = (expected - byIndex.keys).sorted()
    val extra = (byIndex.keys - expected).sorted()
    if (missing.isNotEmpty()) problems += "Missing segment indices: $missing"
    if (extra.isNotEmpty()) problems += "Unexpected segment indices: $extra"

    for (s in segments) {
        if (s.durationInFrames <= 0) {
            problems += "Segment ${s.index}: durationInFrames must be > 0, was ${s.durationInFrames}"
        }
        if (s.from < 0) {
            problems += "Segment ${s.index}: from must be >= 0, was ${s.from}"
        }
        val end = s.from + s.durationInFrames
        if (end > composition.durationInFrames) {
            problems += "Segment ${s.index}: extends to frame $end, past composition.durationInFrames=${composition.durationInFrames}"
        }
    }

    if (audioSegments.isNotEmpty()) {
        try {
            validateAudioSegments(segments.size, audioSegments)
        } catch (e: SegmentValidationException) {
            problems += e.message ?: "audio segment validation failed"
        }
    }

    if (problems.isNotEmpty()) {
        throw SegmentValidationException(
            "Segment validation failed:\n  - " + problems.joinToString("\n  - ") +
                "\nAborting render."
        )
    }
}

/**
 * Convenience: build the AudioTrack list a renderer needs from a per-segment
 * audio map plus the segments that describe their placement.
 *
 * Validates first, so a mismatch fails fast rather than producing a
 * silently-mistimed mix.
 */
fun audioTracksFromSegments(
    segments: List<Segment>,
    audioSegments: Map<Int, AudioTrack>,
): List<AudioTrack> {
    validateAudioSegments(segments.size, audioSegments)
    return segments.sortedBy { it.index }.map { seg ->
        val raw = audioSegments.getValue(seg.index)
        // Honor the segment's `from` as the startFrame, ignoring whatever the
        // caller put on the AudioTrack — segments are the source of truth.
        raw.copy(startFrame = seg.from)
    }
}
