package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * A scoped DSL for sequential scenes: each scene starts when the previous one
 * ends, and each scene's children see a [LocalFrame] clock re-based to 0 at
 * the scene's start.
 *
 * [SeriesScope.Sequence.offset] shifts a scene relative to where it would
 * otherwise start: a positive offset leaves a gap after the previous scene, a
 * negative offset overlaps the previous scene. Because the timeline cursor
 * advances to each scene's end, an offset shifts every following scene too.
 *
 * The last scene may be infinite — pass a negative
 * [SeriesScope.Sequence.durationInFrames] to run it until the end of the
 * composition. Earlier scenes must have a positive duration.
 *
 * ```
 * Series {
 *     Sequence(durationInFrames = 40) { Intro() }
 *     Sequence(durationInFrames = 20, offset = -10) { Main() } // overlaps Intro's last 10 frames
 *     Sequence(durationInFrames = -1) { Outro() }              // runs to the end
 * }
 * ```
 */
@ExperimentalKomotionApi
@Composable
fun Series(content: @Composable SeriesScope.() -> Unit) {
    val scope = SeriesScope()
    content(scope)
    scope.validate()
    scope.compose()
}

/**
 * Builder scope for [Series]. Records the declared scenes and composes them
 * once the whole series is known, so the last scene may be infinite.
 */
@ExperimentalKomotionApi
class SeriesScope internal constructor() {

    private val plans = mutableListOf<ScenePlan>()
    private val contents = mutableListOf<@Composable () -> Unit>()

    /**
     * Declares a scene in [Series].
     *
     * @param durationInFrames the scene's length in frames. Must be positive
     *   except for the last scene, which may be infinite by passing a
     *   negative value.
     * @param offset frames to shift this scene relative to the end of the
     *   previous scene. Positive leaves a gap; negative overlaps the previous
     *   scene. Shifts every following scene too.
     */
    @Composable
    fun Sequence(
        durationInFrames: Int,
        offset: Int = 0,
        content: @Composable () -> Unit,
    ) {
        plans += ScenePlan(durationInFrames, offset)
        contents += content
    }

    internal fun validate() {
        requireValidScenePlans(plans)
    }

    @Composable
    internal fun compose() {
        planSceneWindows(plans).zip(contents).forEach { (window, content) ->
            val globalFrame = LocalFrame.current
            // Outside the window, compose nothing — the scene reserves no space
            // in the parent and its content is not called.
            if (globalFrame in window.from until window.end) {
                CompositionLocalProvider(LocalFrame provides globalFrame - window.from) {
                    content()
                }
            }
        }
    }
}

/** A scene as declared: its length and its shift relative to the previous scene's end. */
internal data class ScenePlan(val durationInFrames: Int, val offset: Int)

/** A scene's resolved window: inclusive [from], exclusive [end]. */
internal data class SceneWindow(val from: Int, val end: Int)

/**
 * Pure frame arithmetic: resolves each declared scene into a [from, end)
 * window. Scenes start back to back; a scene's [ScenePlan.offset] shifts it
 * relative to the previous scene's end, and — because the cursor advances to
 * the scene's end — shifts every following scene too. A negative
 * [ScenePlan.durationInFrames] makes the scene run until [Int.MAX_VALUE].
 */
internal fun planSceneWindows(plans: List<ScenePlan>): List<SceneWindow> {
    val windows = ArrayList<SceneWindow>(plans.size)
    var cursor = 0
    plans.forEach { plan ->
        val from = cursor + plan.offset
        val end = if (plan.durationInFrames < 0) Int.MAX_VALUE else from + plan.durationInFrames
        windows += SceneWindow(from, end)
        cursor = end
    }
    return windows
}

/**
 * Pure validation: at least one scene; every scene has a positive duration
 * except the last, which may be infinite (negative duration).
 */
internal fun requireValidScenePlans(plans: List<ScenePlan>) {
    require(plans.isNotEmpty()) { "Series must declare at least one scene" }
    plans.forEachIndexed { index, plan ->
        val isLast = index == plans.lastIndex
        require(plan.durationInFrames > 0 || (isLast && plan.durationInFrames < 0)) {
            "Scene ${index + 1} must have a positive duration, was ${plan.durationInFrames}; " +
                "only the last scene may be infinite (negative duration)."
        }
    }
}
