package dev.boling.komotion.core

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

class SpringValueTest {

    private val config = SpringConfig(damping = 0.7f, stiffness = 100f, mass = 1f)

    @Test
    fun `springValue starts at from at frame 0`() {
        val value = springValue(0, 30, config, from = 0f, to = 100f, durationInFrames = 30)
        assertEquals(0f, value, 0.001f)
    }

    @Test
    fun `springValue settles at to`() {
        val valueAtEnd = springValue(30, 30, config, 0f, 100f, durationInFrames = 30)
        assertEquals(100f, valueAtEnd, 0.001f)
        // Well past the end of the curve the value stays at `to`
        val valuePastEnd = springValue(60, 30, config, 0f, 100f, durationInFrames = 30)
        assertEquals(100f, valuePastEnd, 0.001f)
    }

    @Test
    fun `durationInFrames stretches the curve to exactly that length`() {
        // The value at the same relative point of the curve is independent of duration
        val midShort = springValue(15, 30, config, 0f, 1f, durationInFrames = 30)
        val midLong = springValue(30, 30, config, 0f, 1f, durationInFrames = 60)
        assertEquals(midShort, midLong, 0.001f)
        // The curve completes at exactly durationInFrames
        assertEquals(1f, springValue(60, 30, config, 0f, 1f, durationInFrames = 60), 0.001f)
    }

    @Test
    fun `delay holds the initial value`() {
        for (frame in 0..4) {
            val value = springValue(frame, 30, config, 0f, 100f, durationInFrames = 30, delay = 5)
            assertEquals(0f, value, 0.001f)
        }
        // After the delay the curve has started
        assertTrue(springValue(10, 30, config, 0f, 100f, durationInFrames = 30, delay = 5) > 0f)
    }

    @Test
    fun `reverse plays the curve backwards`() {
        // Starts at `to` and settles at `from`
        assertEquals(100f, springValue(0, 30, config, 0f, 100f, durationInFrames = 30, reverse = true), 0.001f)
        assertEquals(0f, springValue(40, 30, config, 0f, 100f, durationInFrames = 30, reverse = true), 0.001f)
    }

    @Test
    fun `reverse with delay holds the initial value`() {
        // With reverse the initial value is `to`
        for (frame in 0..4) {
            val value = springValue(frame, 30, config, 0f, 100f, durationInFrames = 30, delay = 5, reverse = true)
            assertEquals(100f, value, 0.001f)
        }
    }

    @Test
    fun `overshootClamping caps at to`() {
        val bouncy = SpringConfig(damping = 0.3f, stiffness = 100f)
        var rawOvershoot = false
        for (frame in 0..60) {
            val raw = springValue(frame, 30, bouncy, 0f, 100f, durationInFrames = 30)
            val clamped = springValue(frame, 30, bouncy, 0f, 100f, durationInFrames = 30, overshootClamping = true)
            if (raw > 100f) rawOvershoot = true
            assertTrue(clamped <= 100f, "Clamped value must not exceed to, got $clamped at frame $frame")
            assertTrue(clamped >= 0f, "Clamped value must not go below from, got $clamped at frame $frame")
        }
        assertTrue(rawOvershoot, "Bouncy spring should overshoot before clamping")
    }

    @Test
    fun `monotonic settling when critically damped`() {
        val critical = SpringConfig(damping = 1.0f, stiffness = 100f)
        var prev = -1f
        for (frame in 0..60) {
            val value = springValue(frame, 30, critical, 0f, 100f, durationInFrames = 30)
            assertTrue(value >= prev, "Critically damped spring should settle monotonically, got $value < $prev at frame $frame")
            prev = value
        }
    }

    @Test
    fun `low damping overshoots to`() {
        val bouncy = SpringConfig(damping = 0.3f, stiffness = 100f)
        var hasOvershot = false
        for (frame in 0..60) {
            if (springValue(frame, 30, bouncy, 0f, 100f, durationInFrames = 30) > 100f) hasOvershot = true
        }
        assertTrue(hasOvershot, "Underdamped spring should overshoot to")
    }

    @Test
    fun `critically damped does not overshoot to`() {
        val critical = SpringConfig(damping = 1.0f, stiffness = 100f)
        for (frame in 0..60) {
            val value = springValue(frame, 30, critical, 0f, 100f, durationInFrames = 30)
            assertTrue(value <= 100f, "Critically damped spring should not overshoot, got $value at frame $frame")
        }
    }

    @Test
    fun `measureSpring reports the settling length`() {
        val bouncy = SpringConfig(damping = 0.3f, stiffness = 100f)
        val critical = SpringConfig(damping = 1.0f, stiffness = 100f)
        val bouncyFrames = measureSpring(bouncy, 30)
        val criticalFrames = measureSpring(critical, 30)
        assertTrue(bouncyFrames > 0, "Bouncy spring should take at least one frame")
        assertTrue(criticalFrames > 0, "Critically damped spring should take at least one frame")
        // A bouncy spring takes longer to settle than a critically damped one
        assertTrue(bouncyFrames > criticalFrames, "Expected bouncy ($bouncyFrames) > critical ($criticalFrames)")
    }

    @Test
    fun `measureSpring threshold controls the settling length`() {
        val bouncy = SpringConfig(damping = 0.3f, stiffness = 100f)
        val tight = measureSpring(bouncy, 30, threshold = 0.001f)
        val loose = measureSpring(bouncy, 30, threshold = 0.05f)
        assertTrue(tight > loose, "Tighter threshold should settle later, got tight=$tight loose=$loose")
    }

    @Test
    fun `springValue and spring easing share the same curve`() {
        val easing = spring(config)
        // The value function is the easing applied to the stretched fraction
        for (frame in 0..30) {
            val fraction = (frame.toDouble() / 30).toFloat().coerceIn(0f, 1f)
            val fromValue = springValue(frame, 30, config, 20f, 80f, durationInFrames = 30)
            val eased = 20f + (80f - 20f) * easing.transform(fraction)
            assertEquals(eased, fromValue, 0.001f)
        }
    }
}

private fun assertEquals(expected: Float, actual: Float, tolerance: Float) {
    assert(abs(expected - actual) <= tolerance) {
        "Expected $expected but was $actual (tolerance $tolerance)"
    }
}
