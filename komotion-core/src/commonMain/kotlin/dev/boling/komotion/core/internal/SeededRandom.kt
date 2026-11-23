package dev.boling.komotion.core.internal

import kotlin.random.Random

/**
 * Deterministic `kotlin.random.Random` factory for seeded random values.
 *
 * The middle layer of the seeded-random stack: `Hashing` → `SeededRandom`
 * → public Random API. All seed derivation is centralized here so the
 * public surface can delegate in a single line, and the RNG strategy can be
 * swapped later without touching the public API.
 */

/**
 * Returns a deterministic [Random] seeded from [seed] and an optional [frame].
 */
internal fun seededRandom(seed: String, frame: Int? = null): Random =
    seededRandom(fnv1a64(seed), frame)

/**
 * Returns a deterministic [Random] seeded from [seed] and an optional [frame].
 *
 * When [frame] is `null`, [seed] is used directly as the RNG seed.
 * When non-null, the frame is folded into the seed so the same seed
 * produces different streams for different frames.
 */
internal fun seededRandom(seed: Long, frame: Int? = null): Random {
    val combined = frame?.let { combineHash(seed, fnv1a64(it.toLong())) } ?: seed
    return Random(combined)
}
