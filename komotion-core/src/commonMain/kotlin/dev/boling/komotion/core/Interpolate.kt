package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp as lerpColor
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.lerp as lerpDp

/**
 * Maps [frame] from [inputRange] to [outputRange] using [easing].
 *
 * Clamps: if frame < inputRange.first, returns outputRange.start.
 *         if frame > inputRange.last,  returns outputRange.endInclusive.
 *
 * This is a pure function — deterministic, no Compose context required.
 */
fun interpolate(
    frame: Int,
    inputRange: IntRange,
    outputRange: ClosedFloatingPointRange<Float>,
    easing: Easing = LinearEasing,
): Float {
    val clamped = frame.coerceIn(inputRange.first, inputRange.last)
    val rangeSize = (inputRange.last - inputRange.first).toFloat()
    val fraction = if (rangeSize == 0f) 1f else (clamped - inputRange.first) / rangeSize
    val easedFraction = easing.transform(fraction)
    val outputSize = outputRange.endInclusive - outputRange.start
    return outputRange.start + easedFraction * outputSize
}

/**
 * Maps [frame] from [inputRange] to an Int [outputRange] using [easing].
 */
fun interpolateInt(
    frame: Int,
    inputRange: IntRange,
    outputRange: IntRange,
    easing: Easing = LinearEasing,
): Int {
    val floatResult = interpolate(
        frame, inputRange,
        outputRange.first.toFloat()..outputRange.last.toFloat(),
        easing,
    )
    return floatResult.roundToInt()
}

/**
 * Maps [frame] from [inputRange] to a [Color] between [start] and [end] using [easing].
 */
fun interpolateColor(
    frame: Int,
    inputRange: IntRange,
    start: Color,
    end: Color,
    easing: Easing = LinearEasing,
): Color {
    val fraction = interpolate(frame, inputRange, 0f..1f, easing)
    return lerpColor(start, end, fraction)
}

/**
 * Maps [frame] from [inputRange] to a [Dp] between [start] and [end] using [easing].
 */
fun interpolateDp(
    frame: Int,
    inputRange: IntRange,
    start: Dp,
    end: Dp,
    easing: Easing = LinearEasing,
): Dp {
    val fraction = interpolate(frame, inputRange, 0f..1f, easing)
    return lerpDp(start, end, fraction)
}

private fun Float.roundToInt(): Int = kotlin.math.round(this).toInt()
