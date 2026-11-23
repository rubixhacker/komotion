package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.layout.Layout
import kotlin.math.floor

/**
 * The name of the nearest enclosing [Sequence], or null if the current content is not
 * inside a [Sequence]. Carried for future timeline display.
 */
val LocalSequenceName = compositionLocalOf { null as String? }

/**
 * A time-windowed container with full timing control.
 *
 * Children are composed while [LocalFrame] is within the sequence's mounted window, and
 * [LocalFrame] is re-based so children see 0 at [from]. The window starts at [from] and
 * lasts [durationInFrames] child frames. When [durationInFrames] is null, the sequence
 * lasts until the parent ends — the window has no upper bound and the parent's own
 * duration terminates it.
 *
 * - [trimBefore] advances the child's frame by the given number of child frames without
 *   moving the window start [from]. Children see negative frames for the first
 *   [trimBefore] frames of the window; interpolation clamps them.
 * - [playbackRate] scales child frames: children see `floor(windowFrame * playbackRate)`
 *   child frames per parent frame, and the mounted window is
 *   `durationInFrames / playbackRate` parent frames long. Rates nest multiplicatively
 *   in nested [Sequence]s.
 * - [freeze] pins the child's frame to the given child frame for as long as the sequence
 *   is mounted, regardless of the parent's [LocalFrame].
 * - [loop] repeats the trimmed range `[0, durationInFrames)`: the sequence stays mounted
 *   until the parent ends and the child's frame cycles through the range. Requires a
 *   non-null [durationInFrames] — the range to repeat must be finite.
 * - [name] is carried via [LocalSequenceName] for future timeline display.
 *
 * [Sequence] adds no layout wrapper by default — children lay out directly in the parent.
 * Outside the window, emits a zero-size Layout so no space is reserved in the parent.
 * Use [AbsoluteFill] for overlay content that should fill the parent.
 */
@Composable
fun Sequence(
    from: Int,
    durationInFrames: Int? = null,
    trimBefore: Int = 0,
    playbackRate: Double = 1.0,
    freeze: Int? = null,
    loop: Boolean = false,
    name: String? = null,
    content: @Composable () -> Unit,
) {
    require(playbackRate > 0.0) {
        "playbackRate must be positive, was $playbackRate"
    }
    require(!loop || durationInFrames != null) {
        "loop requires a finite durationInFrames"
    }
    val globalFrame = LocalFrame.current
    val windowFrame = globalFrame - from
    // A null duration or loop keeps the sequence mounted until the parent ends;
    // otherwise the window ends after durationInFrames / playbackRate parent frames.
    val windowBounded = durationInFrames != null && !loop
    val inWindow = windowFrame >= 0 &&
        (!windowBounded || windowFrame * playbackRate < durationInFrames)
    if (!inWindow) {
        // Emit nothing — zero-size layout so parent reserves no space.
        Layout(content = {}) { _, _ -> layout(0, 0) {} }
        return
    }
    var childFrame = floor(windowFrame * playbackRate).toInt() - trimBefore
    if (freeze != null) {
        childFrame = freeze
    } else if (loop) {
        val duration = durationInFrames!!
        // Positive-modulo idiom: keeps negative frames (from trimBefore) wrapping
        // correctly (Kotlin's Int.% returns a negative result for negative inputs).
        childFrame = ((childFrame % duration) + duration) % duration
    }
    CompositionLocalProvider(
        LocalFrame provides childFrame,
        LocalSequenceName provides name,
    ) {
        content()
    }
}
