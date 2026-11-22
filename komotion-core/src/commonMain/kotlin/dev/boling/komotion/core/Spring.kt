package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import kotlin.math.*

/**
 * Parameters for a damped harmonic oscillator spring.
 *
 * @property damping Damping ratio. 1.0 = critically damped (no overshoot).
 *   Values < 1 are underdamped (bouncy). Values > 1 are overdamped (sluggish).
 *   Default: 0.7 (slightly bouncy — common in UI animation).
 * @property stiffness Spring constant. Higher = faster oscillation. Default: 100.0.
 * @property mass Mass of the object. Higher = more inertia. Default: 1.0.
 */
data class SpringConfig(
    val damping: Float = 0.7f,
    val stiffness: Float = 100f,
    val mass: Float = 1f,
)

/**
 * A physics-based spring easing that maps a 0→1 fraction through a damped
 * harmonic oscillator. The result starts at 0 and settles toward 1.
 *
 * With low [SpringConfig.damping] the spring overshoots (bouncy). With high
 * damping it settles smoothly (critically damped or overdamped).
 *
 * This is the Komotion equivalent of Remotion's `spring()`.
 */
class SpringEasing(val config: SpringConfig) : Easing {

    override fun transform(fraction: Float): Float =
        springProgress(fraction.toDouble(), config).toFloat()
}

/**
 * Creates a [SpringEasing] with the given parameters.
 */
fun spring(
    damping: Float = 0.7f,
    stiffness: Float = 100f,
    mass: Float = 1f,
): Easing = SpringEasing(SpringConfig(damping, stiffness, mass))

/**
 * Creates a [SpringEasing] from a [SpringConfig].
 */
fun spring(config: SpringConfig): Easing = SpringEasing(config)

/**
 * Returns the spring value at [frame]: a value starting at [from] and
 * settling at [to], following a damped harmonic oscillator described by
 * [config].
 *
 * The curve is shaped in this order:
 * 1. **Stretch** — [durationInFrames] stretches the curve to exactly that
 *   length.
 * 2. **Reverse** — if [reverse] is set, the curve plays backwards (starts at
 *   [to] and settles at [from]).
 * 3. **Delay** — [delay] holds the initial value for that many frames before
 *   the curve starts.
 *
 * [overshootClamping] caps the value at [to]: when the spring overshoots, the
 * value is clamped to the [from]–[to] interval instead.
 *
 * This shares its solver with [spring], so the value function and the easing
 * curve never disagree.
 *
 * @param frame Zero-based frame index.
 * @param fps Frames per second the composition plays at.
 * @param config Spring parameters.
 * @param from Value the spring starts from.
 * @param to Value the spring settles at.
 * @param durationInFrames Frames the main motion of the spring takes.
 * @param delay Frames to hold the initial value before the spring starts.
 * @param reverse Play the curve backwards (from [to] toward [from]).
 * @param overshootClamping Clamp the value to the [from]–[to] interval,
 *   removing overshoot.
 */
fun springValue(
    frame: Int,
    fps: Int,
    config: SpringConfig,
    from: Float,
    to: Float,
    durationInFrames: Int,
    delay: Int = 0,
    reverse: Boolean = false,
    overshootClamping: Boolean = false,
): Float {
    require(fps > 0) { "fps must be positive, got $fps" }
    require(durationInFrames > 0) { "durationInFrames must be positive, got $durationInFrames" }
    require(delay >= 0) { "delay must be non-negative, got $delay" }

    // Delay holds the initial value, then the curve is stretched to
    // durationInFrames and optionally reversed.
    val fraction = (frame - delay).toDouble() / durationInFrames
    val progress = springProgress(if (reverse) 1.0 - fraction else fraction, config)
    val raw = (from + (to - from) * progress).toFloat()
    return if (overshootClamping) raw.coerceIn(minOf(from, to), maxOf(from, to)) else raw
}

/**
 * Measures how many frames a spring with [config] takes to settle at the
 * given [fps]: the first frame at which the normalized displacement from rest
 * stays below [threshold] (a fraction of the full from→to distance).
 *
 * Shares its solver with [spring] and [springValue].
 *
 * @param config Spring parameters.
 * @param fps Frames per second the composition plays at.
 * @param threshold Normalized displacement considered settled. Default: 0.01.
 */
fun measureSpring(config: SpringConfig, fps: Int, threshold: Float = 0.01f): Int {
    require(fps > 0) { "fps must be positive, got $fps" }
    require(threshold > 0f) { "threshold must be positive, got $threshold" }

    val omega0 = sqrt(config.stiffness.toDouble() / config.mass.toDouble())
    val zeta = config.damping.toDouble()
    var frame = 0
    while (springEnvelope(frame.toDouble() / fps, zeta, omega0) >= threshold.toDouble()) frame++
    return frame
}

/**
 * The shared spring solver: maps a normalized [fraction] (0 = motion starts,
 * 1 = fully settled) through a damped harmonic oscillator and returns the
 * progress of the motion in the same 0→1 domain. The progress may overshoot 1
 * for underdamped springs.
 *
 * [SpringEasing.transform] and [springValue] both delegate to this, so the
 * easing curve and the value function never disagree.
 */
internal fun springProgress(fraction: Double, config: SpringConfig): Double {
    if (fraction <= 0.0) return 0.0
    if (fraction >= 1.0) return 1.0

    val omega0 = sqrt(config.stiffness.toDouble() / config.mass.toDouble()) // natural frequency
    val zeta = config.damping.toDouble() // damping ratio
    // Scale time so the spring completes its main motion within fraction 0→1.
    // We use 4 time constants as the settling window.
    val settlingTime = 4.0 / (zeta * omega0).coerceAtLeast(0.01)
    val t = fraction * settlingTime
    return 1.0 - springDisplacement(t, zeta, omega0)
}

/**
 * Normalized displacement from rest of a spring released from unit
 * displacement with zero initial velocity, at time [t]. Starts at 1 and
 * settles toward 0.
 */
internal fun springDisplacement(t: Double, zeta: Double, omega0: Double): Double =
    when {
        zeta < 1.0 -> {
            // Underdamped: oscillates
            val omegaD = omega0 * sqrt(1.0 - zeta * zeta)
            exp(-zeta * omega0 * t) * (cos(omegaD * t) + (zeta * omega0 / omegaD) * sin(omegaD * t))
        }
        zeta == 1.0 -> {
            // Critically damped
            (1.0 + omega0 * t) * exp(-omega0 * t)
        }
        else -> {
            // Overdamped: x(0)=1, x'(0)=0 → A=-s2/(s1-s2), B=s1/(s1-s2)
            val s1 = -omega0 * (zeta - sqrt(zeta * zeta - 1.0))
            val s2 = -omega0 * (zeta + sqrt(zeta * zeta - 1.0))
            val a = -s2 / (s1 - s2)
            val b = s1 / (s1 - s2)
            a * exp(s1 * t) + b * exp(s2 * t)
        }
    }

/**
 * Monotonically decreasing upper bound of |springDisplacement|: the envelope
 * of the oscillation. Once it is below a threshold, the displacement stays
 * below it.
 */
internal fun springEnvelope(t: Double, zeta: Double, omega0: Double): Double =
    when {
        zeta < 1.0 -> {
            val omegaD = omega0 * sqrt(1.0 - zeta * zeta)
            sqrt(1.0 + (zeta * omega0 / omegaD).pow(2)) * exp(-zeta * omega0 * t)
        }
        zeta == 1.0 -> {
            // x(t) is positive for t >= 0, so the bound is exact
            (1.0 + omega0 * t) * exp(-omega0 * t)
        }
        else -> {
            val s1 = -omega0 * (zeta - sqrt(zeta * zeta - 1.0))
            val s2 = -omega0 * (zeta + sqrt(zeta * zeta - 1.0))
            val a = -s2 / (s1 - s2)
            val b = s1 / (s1 - s2)
            abs(a) * exp(s1 * t) + abs(b) * exp(s2 * t)
        }
    }
