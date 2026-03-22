package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import kotlin.math.*

/**
 * A physics-based spring easing that maps a 0→1 fraction through a damped
 * harmonic oscillator. The result starts at 0 and settles toward 1.
 *
 * With low [damping] the spring overshoots (bouncy). With high [damping] it
 * settles smoothly (critically damped or overdamped).
 *
 * This is the Komotion equivalent of Remotion's `spring()`.
 *
 * @param damping Damping ratio. 1.0 = critically damped (no overshoot).
 *   Values < 1 are underdamped (bouncy). Values > 1 are overdamped (sluggish).
 *   Default: 0.7 (slightly bouncy — common in UI animation).
 * @param stiffness Spring constant. Higher = faster oscillation. Default: 100.0.
 * @param mass Mass of the object. Higher = more inertia. Default: 1.0.
 */
class SpringEasing(
    val damping: Float = 0.7f,
    val stiffness: Float = 100f,
    val mass: Float = 1f,
) : Easing {

    override fun transform(fraction: Float): Float {
        if (fraction <= 0f) return 0f
        if (fraction >= 1f) return 1f

        val omega0 = sqrt(stiffness / mass).toDouble() // natural frequency
        val zeta = damping.toDouble()                    // damping ratio
        // Scale time so the spring completes its main motion within fraction 0→1.
        // We use 4 time constants as the settling window.
        val settlingTime = 4.0 / (zeta * omega0).coerceAtLeast(0.01)
        val t = fraction * settlingTime

        val displacement: Double = if (zeta < 1.0) {
            // Underdamped: oscillates
            val omegaD = omega0 * sqrt(1.0 - zeta * zeta)
            exp(-zeta * omega0 * t) * (cos(omegaD * t) + (zeta * omega0 / omegaD) * sin(omegaD * t))
        } else if (zeta == 1.0) {
            // Critically damped
            (1.0 + omega0 * t) * exp(-omega0 * t)
        } else {
            // Overdamped: x(0)=1, x'(0)=0 → A=-s2/(s1-s2), B=s1/(s1-s2)
            val s1 = -omega0 * (zeta - sqrt(zeta * zeta - 1.0))
            val s2 = -omega0 * (zeta + sqrt(zeta * zeta - 1.0))
            val a = -s2 / (s1 - s2)
            val b = s1 / (s1 - s2)
            a * exp(s1 * t) + b * exp(s2 * t)
        }

        return (1.0 - displacement).toFloat()
    }
}

/**
 * Creates a [SpringEasing] with default parameters (slightly bouncy).
 */
fun spring(
    damping: Float = 0.7f,
    stiffness: Float = 100f,
    mass: Float = 1f,
): Easing = SpringEasing(damping, stiffness, mass)
