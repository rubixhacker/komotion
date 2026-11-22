package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * Pins [LocalFrame] to the supplied absolute [frame] for its [content],
 * regardless of the parent's [LocalFrame.current].
 *
 * The frozen value is **absolute** — it is not offset by enclosing [Sequence]
 * windows — so it displays a snapshot of an animation at a specific moment
 * while the surrounding timeline continues to advance.
 *
 * Negative or out-of-range values pass through unchanged; callers can
 * interpolate freely without defensive clamping.
 *
 * Example:
 * ```
 * Sequence(from = 30, durationInFrames = 60) {
 *     // Children see LocalFrame 0..59 as the timeline advances.
 *     Freeze(frame = 15) {
 *         // Always sees LocalFrame 15 — a snapshot at that moment.
 *     }
 * }
 * ```
 */
@ExperimentalKomotionApi
@Composable
fun Freeze(
    frame: Int,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalFrame provides frame) {
        content()
    }
}
