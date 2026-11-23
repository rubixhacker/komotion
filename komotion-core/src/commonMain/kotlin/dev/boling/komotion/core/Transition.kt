package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing

/**
 * A transition between two adjacent scenes in a [TransitionSeries].
 *
 * A transition of [durationInFrames] frames consumes that many frames of overlap
 * from the scene before it and the scene after it: the last [durationInFrames] frames
 * of the outgoing scene and the first [durationInFrames] frames of the incoming scene
 * are rendered together, blended according to the transition type.
 *
 * The blend is a pure function of the overlap frame, shaped by [easing].
 */
sealed interface Transition {
    val durationInFrames: Int
    val easing: Easing
}

/** A direction for [SlideTransition] and [WipeTransition]. */
enum class TransitionDirection {
    LeftToRight,
    RightToLeft,
    TopToBottom,
    BottomToTop,
}

/** Cross-fades the outgoing scene into the incoming scene. */
data class FadeTransition(
    override val durationInFrames: Int,
    override val easing: Easing = LinearEasing,
) : Transition

/** Slides the outgoing scene out and the incoming scene in, along [direction]. */
data class SlideTransition(
    override val durationInFrames: Int,
    override val easing: Easing = LinearEasing,
    val direction: TransitionDirection = TransitionDirection.LeftToRight,
) : Transition

/** Wipes the incoming scene over the outgoing one, along [direction]. */
data class WipeTransition(
    override val durationInFrames: Int,
    override val easing: Easing = LinearEasing,
    val direction: TransitionDirection = TransitionDirection.LeftToRight,
) : Transition

/** Reveals the incoming scene with a circle growing from the centre. */
data class IrisTransition(
    override val durationInFrames: Int,
    override val easing: Easing = LinearEasing,
) : Transition

/**
 * Reveals the incoming scene with a circular sector sweeping around the centre,
 * starting at [startAngleDegrees] (degrees, 0 = 3 o'clock, positive counter-clockwise
 * in Compose coordinates) and sweeping progress * 360 degrees, clockwise by default.
 */
data class ClockWipeTransition(
    override val durationInFrames: Int,
    override val easing: Easing = LinearEasing,
    val startAngleDegrees: Float = -90f,
    val clockwise: Boolean = true,
) : Transition

/**
 * The eased progress of a transition at overlap frame [frame].
 *
 * [startFrame] is the first frame of the overlap and [duration] its length in frames.
 * The linear fraction `(frame - startFrame) / duration` is passed through [easing].
 * Frames before the overlap start report 0; frames at or after the overlap end report 1.
 *
 * Pure and deterministic — no Compose context required.
 */
internal fun transitionProgress(
    frame: Int,
    startFrame: Int,
    duration: Int,
    easing: Easing,
): Float {
    val fraction = (frame - startFrame).toFloat() / duration
    return when {
        fraction < 0f -> 0f
        fraction >= 1f -> 1f
        else -> easing.transform(fraction)
    }
}

/**
 * The visual state of a transition at eased progress [progress] in [0, 1].
 *
 * Offsets are fractions of the container's size (1f = one container width/height).
 * [clip] constrains the incoming scene; the outgoing scene is never clipped.
 */
internal data class TransitionFrame(
    val outgoingAlpha: Float,
    val incomingAlpha: Float,
    val outgoingOffset: OffsetFraction,
    val incomingOffset: OffsetFraction,
    val clip: Clip,
)

/** An offset expressed as a fraction of the container's width and height. */
internal data class OffsetFraction(val x: Float, val y: Float) {
    companion object {
        val Zero = OffsetFraction(0f, 0f)
    }
}

/** A clip applied to the incoming scene, in fractions of the container size. */
internal sealed interface Clip {
    object None : Clip

    data class RectClip(val left: Float, val top: Float, val right: Float, val bottom: Float) : Clip

    data class IrisClip(val progress: Float) : Clip

    data class ClockWipeClip(val progress: Float, val startAngleDegrees: Float, val clockwise: Boolean) : Clip
}

/**
 * Computes the visual state of [this] transition at eased progress [progress].
 *
 * Pure and deterministic — no Compose context required.
 */
internal fun Transition.frame(progress: Float): TransitionFrame = when (this) {
    is FadeTransition -> TransitionFrame(
        outgoingAlpha = 1f - progress,
        incomingAlpha = progress,
        outgoingOffset = OffsetFraction.Zero,
        incomingOffset = OffsetFraction.Zero,
        clip = Clip.None,
    )
    is SlideTransition -> {
        val dx = when (direction) {
            TransitionDirection.LeftToRight -> -1f
            TransitionDirection.RightToLeft -> 1f
            else -> 0f
        }
        val dy = when (direction) {
            TransitionDirection.TopToBottom -> -1f
            TransitionDirection.BottomToTop -> 1f
            else -> 0f
        }
        // The `+ 0f` normalizes IEEE negative zero to positive zero, so offsets
        // compare equal at the overlap boundaries (data-class Float equality
        // distinguishes -0.0f from 0.0f).
        TransitionFrame(
            outgoingAlpha = 1f,
            incomingAlpha = 1f,
            outgoingOffset = OffsetFraction(dx * progress + 0f, dy * progress + 0f),
            incomingOffset = OffsetFraction(-dx * (1f - progress) + 0f, -dy * (1f - progress) + 0f),
            clip = Clip.None,
        )
    }
    is WipeTransition -> {
        val rect = when (direction) {
            TransitionDirection.LeftToRight -> Clip.RectClip(0f, 0f, progress, 1f)
            TransitionDirection.RightToLeft -> Clip.RectClip(1f - progress, 0f, 1f, 1f)
            TransitionDirection.TopToBottom -> Clip.RectClip(0f, 0f, 1f, progress)
            TransitionDirection.BottomToTop -> Clip.RectClip(0f, 1f - progress, 1f, 1f)
        }
        TransitionFrame(
            outgoingAlpha = 1f,
            incomingAlpha = 1f,
            outgoingOffset = OffsetFraction.Zero,
            incomingOffset = OffsetFraction.Zero,
            clip = rect,
        )
    }
    is IrisTransition -> TransitionFrame(
        outgoingAlpha = 1f,
        incomingAlpha = 1f,
        outgoingOffset = OffsetFraction.Zero,
        incomingOffset = OffsetFraction.Zero,
        clip = Clip.IrisClip(progress),
    )
    is ClockWipeTransition -> TransitionFrame(
        outgoingAlpha = 1f,
        incomingAlpha = 1f,
        outgoingOffset = OffsetFraction.Zero,
        incomingOffset = OffsetFraction.Zero,
        clip = Clip.ClockWipeClip(progress, startAngleDegrees, clockwise),
    )
}
