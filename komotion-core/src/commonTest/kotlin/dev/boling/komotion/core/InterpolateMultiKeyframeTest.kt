package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class InterpolateMultiKeyframeTest {

    // --- Multi-segment ---

    @Test
    fun `multi-segment interpolates within each segment`() {
        val inputRange = listOf(0, 30, 60)
        val outputRange = listOf(0f, 1f, 0f)
        assertEquals(0.5f, interpolate(15, inputRange, outputRange), 0.001f)
        assertEquals(1f, interpolate(30, inputRange, outputRange), 0.001f)
        assertEquals(0.5f, interpolate(45, inputRange, outputRange), 0.001f)
        assertEquals(0f, interpolate(60, inputRange, outputRange), 0.001f)
    }

    @Test
    fun `multi-segment clamps at the outer keyframes by default`() {
        val inputRange = listOf(0, 30, 60)
        val outputRange = listOf(0f, 1f, 0f)
        assertEquals(0f, interpolate(-10, inputRange, outputRange), 0.001f)
        assertEquals(0f, interpolate(90, inputRange, outputRange), 0.001f)
    }

    @Test
    fun `single keyframe always returns that value`() {
        assertEquals(42f, interpolate(5, listOf(10), listOf(42f)), 0.001f)
        assertEquals(42f, interpolate(-50, listOf(10), listOf(42f)), 0.001f)
        assertEquals(42f, interpolate(500, listOf(10), listOf(42f)), 0.001f)
    }

    // --- Extrapolate modes ---

    @Test
    fun `extend continues the outer segments linearly`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.extend,
            extrapolateRight = ExtrapolateMode.extend,
        )
        assertEquals(-0.5f, interpolate(-15, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        assertEquals(1.5f, interpolate(45, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
    }

    @Test
    fun `extend uses the outer segment of a multi-segment range`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.extend,
            extrapolateRight = ExtrapolateMode.extend,
        )
        // First segment goes 0→1, last segment goes 1→0.
        val inputRange = listOf(0, 30, 60)
        val outputRange = listOf(0f, 1f, 0f)
        // -15 extends the first segment: fraction -0.5 → -0.5
        assertEquals(-0.5f, interpolate(-15, inputRange, outputRange, options), 0.001f)
        // 75 extends the last segment: fraction 1.5 → lerp(1, 0, 1.5) = -0.5
        assertEquals(-0.5f, interpolate(75, inputRange, outputRange, options), 0.001f)
    }

    @Test
    fun `clamp holds the outer keyframe values`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.clamp,
            extrapolateRight = ExtrapolateMode.clamp,
        )
        assertEquals(0f, interpolate(-15, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        assertEquals(1f, interpolate(45, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
    }

    @Test
    fun `wrap repeats the range periodically`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.wrap,
            extrapolateRight = ExtrapolateMode.wrap,
        )
        val inputRange = listOf(0, 30)
        val outputRange = listOf(0f, 1f)
        // 45 wraps to 15, -15 wraps to 15, 60 and 90 wrap to 0.
        assertEquals(0.5f, interpolate(45, inputRange, outputRange, options), 0.001f)
        assertEquals(0.5f, interpolate(-15, inputRange, outputRange, options), 0.001f)
        assertEquals(0f, interpolate(60, inputRange, outputRange, options), 0.001f)
        assertEquals(0f, interpolate(90, inputRange, outputRange, options), 0.001f)
    }

    @Test
    fun `identity returns the input unchanged outside the range`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.identity,
            extrapolateRight = ExtrapolateMode.identity,
        )
        assertEquals(-10f, interpolate(-10, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        assertEquals(40f, interpolate(40, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        // Inside the range, identity behaves like the other modes.
        assertEquals(0.5f, interpolate(15, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
    }

    @Test
    fun `identity works with interpolateInt`() {
        val options = InterpolateOptions(extrapolateRight = ExtrapolateMode.identity)
        assertEquals(40, interpolateInt(40, listOf(0, 30), listOf(0, 100), options))
        assertEquals(50, interpolateInt(15, listOf(0, 30), listOf(0, 100), options))
    }

    @Test
    fun `identity is rejected for non-numeric output`() {
        val options = InterpolateOptions(extrapolateRight = ExtrapolateMode.identity)
        assertFailsWith<IllegalArgumentException> {
            interpolateColor(40, listOf(0, 30), listOf(Color.Black, Color.White), options)
        }
        assertFailsWith<IllegalArgumentException> {
            interpolateDp(40, listOf(0, 30), listOf(0.dp, 10.dp), options)
        }
    }

    // --- Posterize ---

    @Test
    fun `posterize quantizes the input to a step`() {
        val options = InterpolateOptions(posterize = 5)
        // 7 → 5, 12 → 10
        assertEquals(5f / 30f, interpolate(7, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        assertEquals(10f / 30f, interpolate(12, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
    }

    @Test
    fun `posterize holds values between steps`() {
        val options = InterpolateOptions(posterize = 5)
        val a = interpolate(5, listOf(0, 30), listOf(0f, 1f), options)
        val b = interpolate(9, listOf(0, 30), listOf(0f, 1f), options)
        assertEquals(a, b, 0.001f)
    }

    @Test
    fun `posterized input still extrapolates`() {
        val options = InterpolateOptions(
            extrapolateLeft = ExtrapolateMode.extend,
            extrapolateRight = ExtrapolateMode.extend,
            posterize = 5,
        )
        // -7 → -5 → -5/30
        assertEquals(-5f / 30f, interpolate(-7, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
        // 36 → 35 → extend: 35/30
        assertEquals(35f / 30f, interpolate(36, listOf(0, 30), listOf(0f, 1f), options), 0.001f)
    }

    @Test
    fun `posterize of 1 is the identity`() {
        val plain = interpolate(7, listOf(0, 30), listOf(0f, 1f))
        val posterized = interpolate(7, listOf(0, 30), listOf(0f, 1f), InterpolateOptions(posterize = 1))
        assertEquals(plain, posterized, 0.001f)
    }

    // --- Easing: single and per-segment ---

    @Test
    fun `a single easing applies to every segment`() {
        val holdAtOne: Easing = { 1f }
        val inputRange = listOf(0, 10, 20)
        val outputRange = listOf(0f, 10f, 0f)
        val options = InterpolateOptions(easing = listOf(holdAtOne))
        // Both segments jump to their end value immediately.
        assertEquals(10f, interpolate(5, inputRange, outputRange, options), 0.001f)
        assertEquals(0f, interpolate(15, inputRange, outputRange, options), 0.001f)
    }

    @Test
    fun `per-segment easing applies one easing per segment`() {
        val linear: Easing = LinearEasing
        val holdAtOne: Easing = { 1f }
        val inputRange = listOf(0, 10, 20)
        val outputRange = listOf(0f, 10f, 0f)
        val options = InterpolateOptions(easing = listOf(linear, holdAtOne))
        assertEquals(5f, interpolate(5, inputRange, outputRange, options), 0.001f)
        assertEquals(0f, interpolate(15, inputRange, outputRange, options), 0.001f)
        // Swapping the easings swaps which segment is eased.
        val swapped = InterpolateOptions(easing = listOf(holdAtOne, linear))
        assertEquals(10f, interpolate(5, inputRange, outputRange, swapped), 0.001f)
        assertEquals(5f, interpolate(15, inputRange, outputRange, swapped), 0.001f)
    }

    // --- Typed variants with lists ---

    @Test
    fun `interpolateInt interpolates multi-segment Int output`() {
        val inputRange = listOf(0, 30, 60)
        val outputRange = listOf(0, 100, 0)
        assertEquals(50, interpolateInt(15, inputRange, outputRange))
        assertEquals(100, interpolateInt(30, inputRange, outputRange))
        assertEquals(50, interpolateInt(45, inputRange, outputRange))
    }

    @Test
    fun `interpolateColor interpolates multi-segment Color output`() {
        val inputRange = listOf(0, 30, 60)
        val outputRange = listOf(Color.Black, Color.White, Color.Red)
        // Midpoint of black→white is roughly gray.
        val gray = interpolateColor(15, inputRange, outputRange)
        assertTrue(gray.red in 0.3f..0.7f, "Expected gray, got $gray")
        // Midpoint of white→red: red stays 1, green/blue drop to ~0.5.
        val pink = interpolateColor(45, inputRange, outputRange)
        assertTrue(pink.red > 0.9f, "Expected red ~1, got ${pink.red}")
        assertTrue(pink.green in 0.3f..0.7f, "Expected green ~0.5, got ${pink.green}")
    }

    @Test
    fun `interpolateDp interpolates multi-segment Dp output`() {
        val inputRange = listOf(0, 30)
        val outputRange = listOf(0.dp, 100.dp)
        assertDpClose(50.dp, interpolateDp(15, inputRange, outputRange))
    }

    @Test
    fun `interpolateFloats interpolates every component independently`() {
        val inputRange = listOf(0, 20)
        val outputRange = listOf(floatArrayOf(0f, 0f), floatArrayOf(100f, 50f))
        val result = interpolateFloats(10, inputRange, outputRange)
        assertEquals(50f, result[0], 0.001f)
        assertEquals(25f, result[1], 0.001f)
    }

    @Test
    fun `interpolateFloats clamps at the outer keyframes`() {
        val inputRange = listOf(0, 20)
        val outputRange = listOf(floatArrayOf(0f, 0f), floatArrayOf(100f, 50f))
        assertEquals(0f, interpolateFloats(-5, inputRange, outputRange)[0], 0.001f)
        assertEquals(50f, interpolateFloats(99, inputRange, outputRange)[1], 0.001f)
    }

    // --- Validation ---

    @Test
    fun `mismatched list lengths are rejected`() {
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, listOf(0, 30), listOf(0f))
        }
    }

    @Test
    fun `empty lists are rejected`() {
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, emptyList(), emptyList())
        }
    }

    @Test
    fun `non-increasing input range is rejected`() {
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, listOf(30, 0), listOf(0f, 1f))
        }
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, listOf(0, 0), listOf(0f, 1f))
        }
    }

    @Test
    fun `invalid posterize is rejected`() {
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, listOf(0, 30), listOf(0f, 1f), InterpolateOptions(posterize = 0))
        }
    }

    @Test
    fun `invalid per-segment easing size is rejected`() {
        val inputRange = listOf(0, 10, 20) // 2 segments
        assertFailsWith<IllegalArgumentException> {
            interpolate(5, inputRange, listOf(0f, 10f, 0f), InterpolateOptions(easing = listOf(LinearEasing, LinearEasing, LinearEasing)))
        }
    }
}

private fun assertEquals(expected: Float, actual: Float, tolerance: Float) {
    assert(abs(expected - actual) <= tolerance) {
        "Expected $expected but was $actual (tolerance $tolerance)"
    }
}

private fun assertDpClose(expected: Dp, actual: Dp) {
    assert(abs(expected.value - actual.value) <= 1f) {
        "Expected $expected but was $actual"
    }
}
