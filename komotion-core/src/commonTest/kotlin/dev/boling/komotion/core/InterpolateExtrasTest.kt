package dev.boling.komotion.core

import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class InterpolateExtrasTest {

    // --- interpolateInt ---

    @Test
    fun `interpolateInt at midpoint`() {
        val result = interpolateInt(15, 0..30, 0..100)
        assertEquals(50, result)
    }

    @Test
    fun `interpolateInt clamps below range`() {
        val result = interpolateInt(-5, 0..30, 0..100)
        assertEquals(0, result)
    }

    @Test
    fun `interpolateInt clamps above range`() {
        val result = interpolateInt(60, 0..30, 0..100)
        assertEquals(100, result)
    }

    @Test
    fun `interpolateInt at range boundaries`() {
        assertEquals(0, interpolateInt(0, 0..30, 0..100))
        assertEquals(100, interpolateInt(30, 0..30, 0..100))
    }

    // --- interpolateColor ---

    @Test
    fun `interpolateColor at start returns start color`() {
        val result = interpolateColor(0, 0..30, Color.Black, Color.White)
        assertColorEquals(Color.Black, result)
    }

    @Test
    fun `interpolateColor at end returns end color`() {
        val result = interpolateColor(30, 0..30, Color.Black, Color.White)
        assertColorEquals(Color.White, result)
    }

    @Test
    fun `interpolateColor at midpoint returns gray`() {
        val result = interpolateColor(15, 0..30, Color.Black, Color.White)
        // Midpoint of black→white in linear RGB should be roughly gray
        assertTrue(result.red > 0.3f && result.red < 0.7f, "Midpoint red should be ~0.5, got ${result.red}")
    }

    // --- interpolateDp ---

    @Test
    fun `interpolateDp at midpoint`() {
        val result = interpolateDp(15, 0..30, 0.dp, 100.dp)
        assertDpEquals(50.dp, result, tolerance = 1.dp)
    }

    @Test
    fun `interpolateDp at start`() {
        val result = interpolateDp(0, 0..30, 10.dp, 50.dp)
        assertDpEquals(10.dp, result, tolerance = 1.dp)
    }

    @Test
    fun `interpolateDp at end`() {
        val result = interpolateDp(30, 0..30, 10.dp, 50.dp)
        assertDpEquals(50.dp, result, tolerance = 1.dp)
    }

    @Test
    fun `interpolateDp clamps`() {
        assertDpEquals(0.dp, interpolateDp(-5, 0..30, 0.dp, 100.dp), tolerance = 1.dp)
        assertDpEquals(100.dp, interpolateDp(60, 0..30, 0.dp, 100.dp), tolerance = 1.dp)
    }
}

private fun assertColorEquals(expected: Color, actual: Color, tolerance: Float = 0.02f) {
    assertTrue(abs(expected.red - actual.red) <= tolerance, "Red: expected ${expected.red}, got ${actual.red}")
    assertTrue(abs(expected.green - actual.green) <= tolerance, "Green: expected ${expected.green}, got ${actual.green}")
    assertTrue(abs(expected.blue - actual.blue) <= tolerance, "Blue: expected ${expected.blue}, got ${actual.blue}")
}

private fun assertDpEquals(expected: Dp, actual: Dp, tolerance: Dp) {
    assertTrue(abs(expected.value - actual.value) <= tolerance.value,
        "Expected $expected but was $actual (tolerance $tolerance)")
}
