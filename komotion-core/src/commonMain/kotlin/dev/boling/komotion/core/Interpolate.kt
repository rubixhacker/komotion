package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp as lerpColor
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.lerp as lerpDp
import kotlin.math.round

/**
 * Controls how [interpolate] behaves when the input falls outside the
 * keyframe range.
 *
 * - [extend]: continues the first/last segment beyond the range, easing the
 *   extrapolated fraction with that segment's easing.
 * - [clamp]: holds the first/last keyframe value (the default).
 * - [wrap]: wraps the input around the keyframe range, so the animation repeats.
 * - [identity]: returns the input itself, unchanged. Only meaningful for
 *   numeric output ([interpolate] and [interpolateInt]).
 */
enum class ExtrapolateMode { extend, clamp, wrap, identity }

/**
 * Options for the [interpolate] family of functions.
 *
 * @property extrapolateLeft behavior when the input is before the first keyframe.
 * @property extrapolateRight behavior when the input is after the last keyframe.
 * @property posterize quantizes the input to a multiple of this step before
 *   interpolating (1 = no posterization). E.g. `posterize = 3` at 30 fps plays
 *   the animation at 10 fps.
 * @property easing a single [Easing] applied to every segment, or one [Easing]
 *   per segment (size must equal `inputRange.size - 1`).
 */
class InterpolateOptions(
    val extrapolateLeft: ExtrapolateMode = ExtrapolateMode.clamp,
    val extrapolateRight: ExtrapolateMode = ExtrapolateMode.clamp,
    val posterize: Int = 1,
    val easing: List<Easing> = listOf(LinearEasing),
)

/**
 * Maps [input] through the keyframes of [inputRange] onto [outputRange].
 *
 * [inputRange] and [outputRange] must have equal length and at least one
 * element. With a single keyframe the output is always that keyframe's value.
 * With multiple keyframes, each segment between consecutive keyframes is
 * eased by the matching entry of [InterpolateOptions.easing].
 *
 * This is a pure function — deterministic, no Compose context required.
 */
fun interpolate(
    input: Int,
    inputRange: List<Int>,
    outputRange: List<Float>,
    options: InterpolateOptions = InterpolateOptions(),
): Float {
    val resolved = resolve(input, inputRange, outputRange, options)
    return when (resolved) {
        is Resolved.Segment -> lerp(outputRange[resolved.index], outputRange[resolved.index + 1], resolved.fraction)
        is Resolved.Single -> outputRange[resolved.index]
        is Resolved.Identity -> resolved.input.toFloat()
    }
}

/**
 * Maps [input] through the keyframes of [inputRange] onto an Int [outputRange].
 */
fun interpolateInt(
    input: Int,
    inputRange: List<Int>,
    outputRange: List<Int>,
    options: InterpolateOptions = InterpolateOptions(),
): Int {
    val resolved = resolve(input, inputRange, outputRange, options)
    return when (resolved) {
        is Resolved.Segment -> {
            val a = outputRange[resolved.index]
            val b = outputRange[resolved.index + 1]
            (a + (b - a) * resolved.fraction).roundToInt()
        }
        is Resolved.Single -> outputRange[resolved.index]
        is Resolved.Identity -> resolved.input
    }
}

/**
 * Maps [input] through the keyframes of [inputRange] onto a list of [Color]s.
 */
fun interpolateColor(
    input: Int,
    inputRange: List<Int>,
    outputRange: List<Color>,
    options: InterpolateOptions = InterpolateOptions(),
): Color {
    val resolved = resolve(input, inputRange, outputRange, options)
    return when (resolved) {
        is Resolved.Segment -> lerpColor(outputRange[resolved.index], outputRange[resolved.index + 1], resolved.fraction)
        is Resolved.Single -> outputRange[resolved.index]
        is Resolved.Identity -> throw IllegalArgumentException(
            "ExtrapolateMode.identity is not supported for Color output"
        )
    }
}

/**
 * Maps [input] through the keyframes of [inputRange] onto a list of [Dp]s.
 */
fun interpolateDp(
    input: Int,
    inputRange: List<Int>,
    outputRange: List<Dp>,
    options: InterpolateOptions = InterpolateOptions(),
): Dp {
    val resolved = resolve(input, inputRange, outputRange, options)
    return when (resolved) {
        is Resolved.Segment -> lerpDp(outputRange[resolved.index], outputRange[resolved.index + 1], resolved.fraction)
        is Resolved.Single -> outputRange[resolved.index]
        is Resolved.Identity -> throw IllegalArgumentException(
            "ExtrapolateMode.identity is not supported for Dp output"
        )
    }
}

/**
 * Maps [input] through the keyframes of [inputRange] onto a list of multi-component
 * [FloatArray] outputs. Every element of the array is interpolated independently,
 * so one call can drive e.g. an (x, y) offset and a scale at once.
 */
fun interpolateFloats(
    input: Int,
    inputRange: List<Int>,
    outputRange: List<FloatArray>,
    options: InterpolateOptions = InterpolateOptions(),
): FloatArray {
    val resolved = resolve(input, inputRange, outputRange, options)
    require(outputRange.all { it.size == outputRange.first().size }) {
        "Every element of outputRange must have the same number of components"
    }
    return when (resolved) {
        is Resolved.Segment -> {
            val a = outputRange[resolved.index]
            val b = outputRange[resolved.index + 1]
            FloatArray(a.size) { a[it] + (b[it] - a[it]) * resolved.fraction }
        }
        is Resolved.Single -> outputRange[resolved.index].copyOf()
        is Resolved.Identity -> throw IllegalArgumentException(
            "ExtrapolateMode.identity is not supported for multi-component output"
        )
    }
}

// --- Convenience overloads -------------------------------------------------

/**
 * Maps [input] from [inputRange] to [outputRange] using [options].
 */
fun interpolate(
    input: Int,
    inputRange: IntRange,
    outputRange: ClosedFloatingPointRange<Float>,
    options: InterpolateOptions = InterpolateOptions(),
): Float = interpolate(
    input,
    listOf(inputRange.first, inputRange.last),
    listOf(outputRange.start, outputRange.endInclusive),
    options,
)

/**
 * Maps [input] from [inputRange] to an Int [outputRange] using [options].
 */
fun interpolateInt(
    input: Int,
    inputRange: IntRange,
    outputRange: IntRange,
    options: InterpolateOptions = InterpolateOptions(),
): Int = interpolateInt(
    input,
    listOf(inputRange.first, inputRange.last),
    listOf(outputRange.first, outputRange.last),
    options,
)

/**
 * Maps [input] from [inputRange] to a [Color] between [start] and [end] using [options].
 */
fun interpolateColor(
    input: Int,
    inputRange: IntRange,
    start: Color,
    end: Color,
    options: InterpolateOptions = InterpolateOptions(),
): Color = interpolateColor(
    input,
    listOf(inputRange.first, inputRange.last),
    listOf(start, end),
    options,
)

/**
 * Maps [input] from [inputRange] to a [Dp] between [start] and [end] using [options].
 */
fun interpolateDp(
    input: Int,
    inputRange: IntRange,
    start: Dp,
    end: Dp,
    options: InterpolateOptions = InterpolateOptions(),
): Dp = interpolateDp(
    input,
    listOf(inputRange.first, inputRange.last),
    listOf(start, end),
    options,
)

// --- Core resolution -------------------------------------------------------

/**
 * Where the (posterized) [input] lands on the keyframe path: an eased
 * [Resolved.Segment.fraction] within segment [Resolved.Segment.index] (the fraction
 * may be < 0 or > 1 when extended), a [Resolved.Single] keyframe, or an
 * [Resolved.Identity] passthrough of the posterized input.
 */
internal sealed class Resolved {
    data class Segment(val index: Int, val fraction: Float) : Resolved()
    /** A single keyframe: the output is always that keyframe's value. */
    data class Single(val index: Int) : Resolved()
    data class Identity(val input: Int) : Resolved()
}

private fun <T> resolve(input: Int, inputRange: List<Int>, outputRange: List<T>, options: InterpolateOptions): Resolved {
    require(inputRange.size == outputRange.size) {
        "inputRange (${inputRange.size}) and outputRange (${outputRange.size}) must have equal length"
    }
    require(inputRange.isNotEmpty()) { "inputRange must contain at least one element" }
    require(inputRange.zip(inputRange.drop(1)).all { (a, b) -> a < b }) {
        "inputRange must be strictly increasing, got $inputRange"
    }
    require(options.posterize >= 1) { "posterize must be >= 1, got ${options.posterize}" }
    val segments = inputRange.size - 1
    require(options.easing.size == 1 || options.easing.size == segments) {
        "easing must be a single Easing or one per segment ($segments segments), got ${options.easing.size}"
    }

    if (segments == 0) return Resolved.Single(0)

    val effective = input / options.posterize * options.posterize
    val first = inputRange.first()
    val last = inputRange.last()
    val wrapTo = { x: Int -> resolveInRange(first + mod(x - first, last - first), inputRange, options) }

    return when {
        effective < first -> when (options.extrapolateLeft) {
            ExtrapolateMode.clamp -> Resolved.Segment(0, 0f)
            ExtrapolateMode.identity -> Resolved.Identity(effective)
            ExtrapolateMode.extend -> Resolved.Segment(0, ease(options, 0, extendFraction(effective, first, inputRange[1])))
            ExtrapolateMode.wrap -> wrapTo(effective)
        }
        effective > last -> when (options.extrapolateRight) {
            ExtrapolateMode.clamp -> Resolved.Segment(segments - 1, 1f)
            ExtrapolateMode.identity -> Resolved.Identity(effective)
            ExtrapolateMode.extend -> Resolved.Segment(segments - 1, ease(options, segments - 1, extendFraction(effective, inputRange[segments - 1], last)))
            ExtrapolateMode.wrap -> wrapTo(effective)
        }
        else -> resolveInRange(effective, inputRange, options)
    }
}

/**
 * Resolves [input] to an eased segment, assuming it is within the keyframe range.
 */
private fun resolveInRange(input: Int, inputRange: List<Int>, options: InterpolateOptions): Resolved.Segment {
    var i = 0
    while (i < inputRange.lastIndex && input > inputRange[i + 1]) i++
    val fraction = (input - inputRange[i]).toFloat() / (inputRange[i + 1] - inputRange[i]).toFloat()
    return Resolved.Segment(i, ease(options, i, fraction))
}

/**
 * The fraction of the way from [from] to [to] that [effective] lies, for
 * extrapolation beyond the range (negative before [from], > 1 after [to]).
 */
private fun extendFraction(effective: Int, from: Int, to: Int): Float =
    (effective - from).toFloat() / (to - from).toFloat()

/**
 * Applies the easing for segment [segment] to [fraction].
 */
private fun ease(options: InterpolateOptions, segment: Int, fraction: Float): Float {
    val easings = options.easing
    val easing = if (easings.size == 1) easings[0] else easings[segment]
    return easing.transform(fraction)
}

private fun lerp(a: Float, b: Float, fraction: Float): Float = a + (b - a) * fraction

private fun mod(a: Int, n: Int): Int = (a % n + n) % n

private fun Float.roundToInt(): Int = round(this).toInt()
