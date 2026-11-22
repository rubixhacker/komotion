package dev.boling.komotion.core

import kotlin.test.Test

class InterpolateTest {

    @Test
    fun `in-range interpolates linearly`() {
        val result = interpolate(15, 0..30, 0f..1f)
        assertEquals(0.5f, result, absoluteTolerance = 0.001f)
    }

    @Test
    fun `at range start returns output start`() {
        val result = interpolate(0, 0..30, 0f..1f)
        assertEquals(0f, result, absoluteTolerance = 0.001f)
    }

    @Test
    fun `at range end returns output end`() {
        val result = interpolate(30, 0..30, 0f..1f)
        assertEquals(1f, result, absoluteTolerance = 0.001f)
    }

    @Test
    fun `frame before range clamps to output start by default`() {
        val result = interpolate(-5, 0..30, 0f..1f)
        assertEquals(0f, result, absoluteTolerance = 0.001f)
    }

    @Test
    fun `frame after range clamps to output end by default`() {
        val result = interpolate(60, 0..30, 0f..1f)
        assertEquals(1f, result, absoluteTolerance = 0.001f)
    }

    @Test
    fun `works with non-zero output range`() {
        val result = interpolate(10, 0..20, 100f..200f)
        assertEquals(150f, result, absoluteTolerance = 0.001f)
    }
}

// kotlin.test has no KMP-common float-tolerance overload, so we use our own.
private fun assertEquals(expected: Float, actual: Float, absoluteTolerance: Float) {
    assert(kotlin.math.abs(expected - actual) <= absoluteTolerance) {
        "Expected $expected but was $actual (tolerance $absoluteTolerance)"
    }
}
