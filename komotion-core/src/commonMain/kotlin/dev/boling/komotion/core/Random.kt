package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.internal.seededRandom

/**
 * Returns a deterministic pseudo-random [Double] in `[0.0, 1.0)` derived from [seed].
 *
 * Pure: the same seed always returns the same value, and the function is
 * callable from any context, including non-Composable code.
 *
 * Example:
 *   val phase = random("particle-1")
 */
@ExperimentalKomotionApi
fun random(seed: String): Double = seededRandom(seed).nextDouble()

/**
 * Returns a deterministic pseudo-random [Double] in `[0.0, 1.0)` derived from [seed].
 *
 * Pure: the same seed always returns the same value, and the function is
 * callable from any context, including non-Composable code.
 *
 * Example:
 *   val phase = random(42L)
 */
@ExperimentalKomotionApi
fun random(seed: Long): Double = seededRandom(seed).nextDouble()

/**
 * Returns a deterministic pseudo-random [Double] in `[0.0, 1.0)` derived from
 * [seed] and the current [LocalFrame].
 *
 * Unlike the pure [random] variants, which return the same value for a given
 * seed on every frame, this variant folds the current frame into the seed: the
 * same `(seed, frame)` pair always returns the same value, while different
 * frames return different values for the same seed. Use it for per-frame
 * procedural variation that stays reproducible across renders.
 *
 * Example:
 *   val jitter = randomPerFrame("particle-1")
 */
@ExperimentalKomotionApi
@Composable
fun randomPerFrame(seed: String): Double =
    seededRandom(seed, frame = LocalFrame.current).nextDouble()

/**
 * Returns a deterministic pseudo-random [Double] in `[0.0, 1.0)` derived from
 * [seed] and the current [LocalFrame].
 *
 * Unlike the pure [random] variants, which return the same value for a given
 * seed on every frame, this variant folds the current frame into the seed: the
 * same `(seed, frame)` pair always returns the same value, while different
 * frames return different values for the same seed. Use it for per-frame
 * procedural variation that stays reproducible across renders.
 *
 * Example:
 *   val jitter = randomPerFrame(42L)
 */
@ExperimentalKomotionApi
@Composable
fun randomPerFrame(seed: Long): Double =
    seededRandom(seed, frame = LocalFrame.current).nextDouble()
