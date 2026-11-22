package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlin.math.sqrt

/**
 * A scoped DSL alternating scenes and transitions:
 *
 * ```
 * TransitionSeries {
 *     Scene(40) { TitleCard() }
 *     Fade(durationInFrames = 10)
 *     Scene(30) { BarChart() }
 * }
 * ```
 *
 * Each transition consumes [Transition.durationInFrames] frames of overlap from the
 * scene before it and the scene after it, so the total timeline is the sum of the
 * scene durations minus the overlaps. During the overlap the two adjacent scenes are
 * rendered together, blended by the transition.
 *
 * Outside the timeline's window the series emits a zero-size layout, reserving no
 * space in the parent.
 */
@Composable
@ExperimentalKomotionApi
fun TransitionSeries(content: @Composable TransitionScope.() -> Unit) {
    val scope = TransitionScope()
    scope.content()
    TransitionSeries(scope)
}

/**
 * Renders a [TransitionScope] built outside a composable context, e.g. to compute
 * [TransitionScope.totalDurationInFrames] for a [Composition] from the same scope.
 */
@Composable
@ExperimentalKomotionApi
fun TransitionSeries(scope: TransitionScope) {
    val timeline = TransitionTimeline(scope.items)
    val frame = LocalFrame.current
    if (frame !in 0 until timeline.totalDurationInFrames) {
        // Emit nothing — zero-size layout so the parent reserves no space.
        Layout(content = {}) { _, _ -> layout(0, 0) {} }
        return
    }
    val transition = timeline.transitions.firstOrNull {
        frame in it.startFrame until it.startFrame + it.durationInFrames
    }
    if (transition == null) {
        val scene = timeline.scenes.first {
            frame in it.startFrame until it.startFrame + it.durationInFrames
        }
        SceneView(scene, frame)
    } else {
        TransitionView(transition, frame)
    }
}

/**
 * The builder scope of [TransitionSeries]. Alternates [Scene]s with transition
 * calls ([Fade], [Slide], [Wipe], [Iris], [ClockWipe]).
 *
 * The scope is a plain value object: it records the timeline and can be built
 * outside a composable context, e.g. to compute [totalDurationInFrames] for a
 * [Composition].
 */
class TransitionScope {
    internal val items = mutableListOf<TimelineItem>()

    /** A scene of [durationInFrames] frames, rendered by [content]. */
    fun Scene(durationInFrames: Int, content: @Composable () -> Unit) {
        require(durationInFrames > 0) { "Scene duration must be positive, was $durationInFrames" }
        items.add(SceneItem(durationInFrames, content))
    }

    /** A cross-fade between the surrounding scenes. */
    fun Fade(durationInFrames: Int, easing: Easing = LinearEasing) {
        items.add(TransitionItem(FadeTransition(durationInFrames, easing)))
    }

    /** A slide between the surrounding scenes. */
    fun Slide(
        durationInFrames: Int,
        easing: Easing = LinearEasing,
        direction: TransitionDirection = TransitionDirection.LeftToRight,
    ) {
        items.add(TransitionItem(SlideTransition(durationInFrames, easing, direction)))
    }

    /** A wipe between the surrounding scenes. */
    fun Wipe(
        durationInFrames: Int,
        easing: Easing = LinearEasing,
        direction: TransitionDirection = TransitionDirection.LeftToRight,
    ) {
        items.add(TransitionItem(WipeTransition(durationInFrames, easing, direction)))
    }

    /** An iris reveal between the surrounding scenes. */
    fun Iris(durationInFrames: Int, easing: Easing = LinearEasing) {
        items.add(TransitionItem(IrisTransition(durationInFrames, easing)))
    }

    /** A clock-wipe reveal between the surrounding scenes. */
    fun ClockWipe(
        durationInFrames: Int,
        easing: Easing = LinearEasing,
        startAngleDegrees: Float = -90f,
        clockwise: Boolean = true,
    ) {
        items.add(TransitionItem(ClockWipeTransition(durationInFrames, easing, startAngleDegrees, clockwise)))
    }

    /**
     * The total duration of the timeline in frames: the sum of the scene durations
     * minus the overlap frames of every transition.
     */
    val totalDurationInFrames: Int
        get() = TransitionTimeline(items).totalDurationInFrames
}

internal sealed interface TimelineItem {
    val durationInFrames: Int
}

internal data class SceneItem(
    override val durationInFrames: Int,
    val content: @Composable () -> Unit,
) : TimelineItem

internal data class TransitionItem(val transition: Transition) : TimelineItem {
    override val durationInFrames: Int get() = transition.durationInFrames
}

internal data class PlacedScene(
    val startFrame: Int,
    val durationInFrames: Int,
    val content: @Composable () -> Unit,
) {
    val endFrame: Int get() = startFrame + durationInFrames
}

internal data class PlacedTransition(
    val startFrame: Int,
    val durationInFrames: Int,
    val transition: Transition,
    val outgoing: PlacedScene,
    val incoming: PlacedScene,
) {
    val endFrame: Int get() = startFrame + durationInFrames
}

/**
 * Places scenes and transitions on the timeline.
 *
 * Scenes run back-to-back; a transition starts [Transition.durationInFrames] frames
 * before the end of the scene before it, and the scene after it starts at the
 * transition's start frame. The total duration is therefore the sum of the scene
 * durations minus the overlaps.
 *
 * Pure and deterministic — no Compose context required.
 */
internal class TransitionTimeline(items: List<TimelineItem>) {
    val scenes: List<PlacedScene>
    val transitions: List<PlacedTransition>
    val totalDurationInFrames: Int

    init {
        val scenes = mutableListOf<PlacedScene>()
        val transitions = mutableListOf<PlacedTransition>()
        var base = 0
        var pendingOutgoing: PlacedScene? = null
        var pendingTransition: Transition? = null
        var pendingStart = 0
        var pendingDuration = 0
        for (item in items) {
            when (item) {
                is SceneItem -> {
                    val outgoing = pendingOutgoing
                    val scene = PlacedScene(base, item.durationInFrames, item.content)
                    if (outgoing != null) {
                        val t = pendingTransition!!
                        val d = pendingDuration
                        require(item.durationInFrames >= d) {
                            "A $d-frame transition cannot overlap more frames than the ${item.durationInFrames}-frame scene after it"
                        }
                        transitions.add(PlacedTransition(pendingStart, d, t, outgoing, scene))
                        pendingTransition = null
                    }
                    pendingOutgoing = scene
                    scenes.add(scene)
                    base = scene.endFrame
                }
                is TransitionItem -> {
                    val outgoing = pendingOutgoing ?: throw IllegalArgumentException(
                        "A transition must follow a scene in a TransitionSeries"
                    )
                    require(pendingTransition == null) {
                        "Transitions must alternate with scenes in a TransitionSeries"
                    }
                    val start = base - item.transition.durationInFrames
                    require(start >= outgoing.startFrame) {
                        "A ${item.transition.durationInFrames}-frame transition cannot overlap more frames than the ${outgoing.durationInFrames}-frame scene before it"
                    }
                    pendingTransition = item.transition
                    pendingStart = start
                    pendingDuration = item.transition.durationInFrames
                    base = start
                }
            }
        }
        if (pendingTransition != null) {
            throw IllegalArgumentException("A transition must be followed by a scene in a TransitionSeries")
        }
        this.scenes = scenes
        this.transitions = transitions
        totalDurationInFrames = base
    }
}

@Composable
private fun SceneView(scene: PlacedScene, globalFrame: Int) {
    TransitionBox {
        CompositionLocalProvider(LocalFrame provides globalFrame - scene.startFrame) {
            scene.content()
        }
    }
}

@Composable
private fun TransitionView(transition: PlacedTransition, globalFrame: Int) {
    val progress = transitionProgress(
        frame = globalFrame,
        startFrame = transition.startFrame,
        duration = transition.durationInFrames,
        easing = transition.transition.easing,
    )
    val frame = transition.transition.frame(progress)
    TransitionBox(clip = true) {
        TransitionScene(
            scene = transition.outgoing,
            globalFrame = globalFrame,
            alpha = frame.outgoingAlpha,
            offset = frame.outgoingOffset,
        )
        TransitionScene(
            scene = transition.incoming,
            globalFrame = globalFrame,
            alpha = frame.incomingAlpha,
            offset = frame.incomingOffset,
            clip = frame.clip,
        )
    }
}

@Composable
private fun TransitionScene(
    scene: PlacedScene,
    globalFrame: Int,
    alpha: Float,
    offset: OffsetFraction,
    clip: Clip = Clip.None,
) {
    TransitionBox(
        modifier = Modifier
            .graphicsLayer {
                this.alpha = alpha
                translationX = offset.x * size.width
                translationY = offset.y * size.height
            }
            .applyClip(clip),
    ) {
        CompositionLocalProvider(LocalFrame provides globalFrame - scene.startFrame) {
            scene.content()
        }
    }
}

/**
 * Measures all children with the incoming constraints and places them stacked at
 * the origin, so several scenes can occupy the same space during a transition.
 */
@Composable
private fun TransitionBox(
    modifier: Modifier = Modifier,
    clip: Boolean = false,
    content: @Composable () -> Unit,
) {
    val effectiveModifier = if (clip) modifier.clipToBounds() else modifier
    Layout(content = content, modifier = effectiveModifier) { measurables, constraints ->
        val placeables = measurables.map { it.measure(constraints) }
        val width = placeables.maxOfOrNull { it.width } ?: 0
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(width, height) {
            placeables.forEach { it.place(0, 0) }
        }
    }
}

private fun Modifier.applyClip(clip: Clip): Modifier = when (clip) {
    Clip.None -> this
    is Clip.RectClip -> clip(RectClipShape(clip.left, clip.top, clip.right, clip.bottom))
    is Clip.IrisClip -> clip(IrisClipShape(clip.progress))
    is Clip.ClockWipeClip -> clip(ClockWipeClipShape(clip.progress, clip.startAngleDegrees, clip.clockwise))
}

/** Clips the incoming scene to a rectangle [left]..[right] x [top]..[bottom], in fractions of the size. */
private class RectClipShape(
    private val left: Float,
    private val top: Float,
    private val right: Float,
    private val bottom: Float,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val rect = Rect(
            left = left * size.width,
            top = top * size.height,
            right = right * size.width,
            bottom = bottom * size.height,
        )
        return Outline.Rectangle(rect)
    }
}

/** Clips the incoming scene to a circle centred in the size, with radius [progress] of the full-cover radius. */
private class IrisClipShape(private val progress: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val radius = progress * fullCoverRadius(size)
        val cx = size.width / 2f
        val cy = size.height / 2f
        val oval = Rect(cx - radius, cy - radius, cx + radius, cy + radius)
        val path = Path().apply { addOval(oval) }
        return Outline.Generic(path)
    }
}

/**
 * Clips the incoming scene to a circular sector centred in the size: radius is the
 * full-cover radius, starting at [startAngleDegrees] and sweeping [progress] of 360°.
 */
private class ClockWipeClipShape(
    private val progress: Float,
    private val startAngleDegrees: Float,
    private val clockwise: Boolean,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val radius = fullCoverRadius(size)
        val cx = size.width / 2f
        val cy = size.height / 2f
        val sweep = if (clockwise) progress * 360f else -progress * 360f
        val path = Path().apply {
            moveTo(cx, cy)
            arcTo(Rect(cx - radius, cy - radius, cx + radius, cy + radius), startAngleDegrees, sweep, false)
            close()
        }
        return Outline.Generic(path)
    }
}

/** The radius of a circle centred in [size] that just covers it. */
private fun fullCoverRadius(size: Size): Float =
    0.5f * sqrt(size.width * size.width + size.height * size.height)
