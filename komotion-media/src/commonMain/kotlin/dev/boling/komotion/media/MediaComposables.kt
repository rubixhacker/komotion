package dev.boling.komotion.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.boling.komotion.core.LocalFrame

/**
 * Declares an audio file to be mixed into the exported output.
 *
 * The declaration is registered with the current [LocalMediaCollector] while
 * the enclosing composition is composed, so preview and export consume the
 * same declaration. [startFrame] is relative to the nearest enclosing
 * [dev.boling.komotion.core.Sequence] (or the composition start if none).
 *
 * The composable emits no layout.
 */
@Composable
fun Audio(
    file: String,
    startFrame: Int = 0,
    volume: Float = 1f,
    playbackRate: Float = 1f,
    trimStartFrame: Int = 0,
    trimEndFrame: Int? = null,
    muted: Boolean = false,
): AudioMedia {
    val declaration = AudioMedia(
        file = file,
        startFrame = registerStartFrame(startFrame),
        volume = volume,
        playbackRate = playbackRate,
        trimStartFrame = trimStartFrame,
        trimEndFrame = trimEndFrame,
        muted = muted,
    )
    registerDeclaration(declaration)
    return declaration
}

/**
 * Declares a video file to be embedded in the composition.
 *
 * The declaration is registered with the current [LocalMediaCollector] while
 * the enclosing composition is composed. [startFrame] is relative to the
 * nearest enclosing [dev.boling.komotion.core.Sequence] (or the composition
 * start if none).
 *
 * The composable emits no layout; use it alongside the visual content that
 * plays the clip.
 */
@Composable
fun Video(
    file: String,
    startFrame: Int = 0,
    volume: Float = 1f,
    playbackRate: Float = 1f,
    trimStartFrame: Int = 0,
    trimEndFrame: Int? = null,
    muted: Boolean = false,
): VideoMedia {
    val declaration = VideoMedia(
        file = file,
        startFrame = registerStartFrame(startFrame),
        volume = volume,
        playbackRate = playbackRate,
        trimStartFrame = trimStartFrame,
        trimEndFrame = trimEndFrame,
        muted = muted,
    )
    registerDeclaration(declaration)
    return declaration
}

/**
 * Declares an image file used by the composition.
 *
 * The declaration is registered with the current [LocalMediaCollector] while
 * the enclosing composition is composed. [startFrame] is relative to the
 * nearest enclosing [dev.boling.komotion.core.Sequence] (or the composition
 * start if none).
 *
 * The composable emits no layout.
 */
@Composable
fun Image(
    file: String,
    startFrame: Int = 0,
    volume: Float = 1f,
    playbackRate: Float = 1f,
    trimStartFrame: Int = 0,
    trimEndFrame: Int? = null,
    muted: Boolean = false,
): ImageMedia {
    val declaration = ImageMedia(
        file = file,
        startFrame = registerStartFrame(startFrame),
        volume = volume,
        playbackRate = playbackRate,
        trimStartFrame = trimStartFrame,
        trimEndFrame = trimEndFrame,
        muted = muted,
    )
    registerDeclaration(declaration)
    return declaration
}

/**
 * Shifts [startFrame] from the local frame space of the nearest enclosing
 * Sequence onto the global timeline, and registers the result with the
 * current collector under a stable per-call-site token.
 */
@Composable
internal fun registerStartFrame(startFrame: Int): Int {
    val collector = LocalMediaCollector.current
    return collector.frame - LocalFrame.current + startFrame
}

@Composable
internal fun registerDeclaration(media: Media) {
    val collector = LocalMediaCollector.current
    val token = remember { MediaToken() }
    collector.register(token, media)
}
