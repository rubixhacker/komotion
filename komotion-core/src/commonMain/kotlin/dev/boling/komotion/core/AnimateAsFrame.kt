package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp

/**
 * Reads [LocalFrame] and interpolates a Float between [outputRange].
 *
 * Example:
 *   val opacity = animateFloatAsFrame(0..30, 0f..1f)
 */
@Composable
fun animateFloatAsFrame(
    inputRange: IntRange,
    outputRange: ClosedFloatingPointRange<Float>,
    easing: Easing = LinearEasing,
): Float {
    val frame = LocalFrame.current
    return interpolate(frame, inputRange, outputRange, easing)
}

/**
 * Reads [LocalFrame] and interpolates an Int between [outputRange].
 *
 * Example:
 *   val count = animateIntAsFrame(0..60, 0..100)
 */
@Composable
fun animateIntAsFrame(
    inputRange: IntRange,
    outputRange: IntRange,
    easing: Easing = LinearEasing,
): Int {
    val frame = LocalFrame.current
    return interpolateInt(frame, inputRange, outputRange, easing)
}

/**
 * Reads [LocalFrame] and interpolates a [Color] between [start] and [end].
 *
 * Example:
 *   val bg = animateColorAsFrame(0..30, Color.Black, Color.White)
 */
@Composable
fun animateColorAsFrame(
    inputRange: IntRange,
    start: Color,
    end: Color,
    easing: Easing = LinearEasing,
): Color {
    val frame = LocalFrame.current
    return interpolateColor(frame, inputRange, start, end, easing)
}

/**
 * Reads [LocalFrame] and interpolates a [Dp] between [start] and [end].
 *
 * Example:
 *   val padding = animateDpAsFrame(0..30, 0.dp, 16.dp)
 */
@Composable
fun animateDpAsFrame(
    inputRange: IntRange,
    start: Dp,
    end: Dp,
    easing: Easing = LinearEasing,
): Dp {
    val frame = LocalFrame.current
    return interpolateDp(frame, inputRange, start, end, easing)
}
