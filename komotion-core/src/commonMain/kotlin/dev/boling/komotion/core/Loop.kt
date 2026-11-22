package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * Cycles [LocalFrame] for its children modulo [durationInFrames], so the subtree
 * animates on a repeating [durationInFrames]-frame cycle within the parent's render
 * window.
 *
 * [Loop] has no iteration count. To bound how many times the loop repeats, compose it
 * inside a [Sequence] that limits the parent's render window:
 *
 * ```
 * Sequence(from = 30, durationInFrames = 90) {  // 3 iterations of a 30-frame loop
 *     Loop(durationInFrames = 30) { Pulse() }
 * }
 * ```
 */
@Composable
@ExperimentalKomotionApi
fun Loop(
    durationInFrames: Int,
    content: @Composable () -> Unit,
) {
    require(durationInFrames > 0) {
        "durationInFrames must be positive, was $durationInFrames"
    }
    val parentFrame = LocalFrame.current
    // Positive-modulo idiom: keeps negative parent frames wrapping correctly
    // (Kotlin's Int.% returns a negative result for negative inputs).
    val localFrame = ((parentFrame % durationInFrames) + durationInFrames) % durationInFrames
    CompositionLocalProvider(LocalFrame provides localFrame) {
        content()
    }
}
