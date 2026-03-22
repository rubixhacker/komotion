package dev.boling.komotion.core

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

class SpringTest {

    @Test
    fun `spring starts at 0`() {
        val easing = spring()
        assertEquals(0f, easing.transform(0f), 0.001f)
    }

    @Test
    fun `spring settles near 1 at end`() {
        val easing = spring()
        assertEquals(1f, easing.transform(1f), 0.001f)
    }

    @Test
    fun `underdamped spring overshoots 1`() {
        val easing = spring(damping = 0.3f, stiffness = 100f)
        // Sample the middle of the animation — underdamped springs overshoot
        var hasOvershot = false
        for (i in 1..99) {
            val fraction = i / 100f
            val value = easing.transform(fraction)
            if (value > 1.01f) hasOvershot = true
        }
        assertTrue(hasOvershot, "Underdamped spring should overshoot 1.0")
    }

    @Test
    fun `critically damped spring does not overshoot`() {
        val easing = spring(damping = 1.0f, stiffness = 100f)
        for (i in 0..100) {
            val fraction = i / 100f
            val value = easing.transform(fraction)
            assertTrue(value <= 1.01f, "Critically damped spring should not overshoot significantly, got $value at fraction $fraction")
        }
    }

    @Test
    fun `overdamped spring does not overshoot`() {
        val easing = spring(damping = 2.0f, stiffness = 100f)
        for (i in 0..100) {
            val fraction = i / 100f
            val value = easing.transform(fraction)
            assertTrue(value <= 1.01f, "Overdamped spring should not overshoot, got $value at fraction $fraction")
        }
    }

    @Test
    fun `spring is monotonically increasing in early phase`() {
        val easing = spring(damping = 1.0f)
        var prev = 0f
        // Check first 30% — all spring types should be increasing early
        for (i in 1..30) {
            val value = easing.transform(i / 100f)
            assertTrue(value >= prev, "Spring should increase early, got $value < $prev at ${i}%")
            prev = value
        }
    }

    @Test
    fun `spring works with interpolate`() {
        val result = interpolate(15, 0..30, 0f..100f, spring(damping = 0.7f))
        // At halfway with a bouncy spring, value should be past 50 (overshoot tendency)
        assertTrue(result > 40f, "Spring-eased midpoint should be significant, got $result")
    }
}

private fun assertEquals(expected: Float, actual: Float, tolerance: Float) {
    assert(abs(expected - actual) <= tolerance) {
        "Expected $expected but was $actual (tolerance $tolerance)"
    }
}
