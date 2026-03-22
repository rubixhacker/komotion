package dev.boling.komotion.core

import androidx.compose.runtime.compositionLocalOf

/**
 * Defines the dimensions, frame rate, and duration of an animation.
 */
data class Composition(
    val width: Int,
    val height: Int,
    val durationInFrames: Int,
    val fps: Int = 30,
)

/**
 * The current frame number within the nearest enclosing Sequence or KomotionPlayer.
 * Defaults to 0. Always read-only from composition code.
 */
val LocalFrame = compositionLocalOf { 0 }

/**
 * The Composition describing the current animation context.
 * Fails fast if accessed without a provider — wrap content in KomotionPlayer
 * or CompositionLocalProvider(LocalComposition provides myComposition).
 */
val LocalComposition = compositionLocalOf<Composition> {
    error(
        "No LocalComposition provided. " +
        "Wrap your content with KomotionPlayer or " +
        "CompositionLocalProvider(LocalComposition provides myComposition)."
    )
}
