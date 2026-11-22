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
 *
 * When [frame] is `null`, the seed is derived purely from the seed's hash.
 * When non-null, the frame is folded in via `combineHash(seedHash, fnv1a64(frame.toLong()))`
 * so per-frame variation is reproducible.
 */
internal fun seededRandom(seed: String, frame: Int? = null): Random =
    seededRandomFromHash(fnv1a64(seed), frame)

/**
 * Returns a deterministic [Random] seeded from [seed] and an optional [frame].
 *
 * See the [seededRandom] overload for the seeding contract.
 */
internal fun seededRandom(seed: Long, frame: Int? = null): Random =
    seededRandomFromHash(fnv1a64(seed), frame)

/**
 * Builds a deterministic [Random] from an already-hashed [seedHash] and an
 * optional [frame].
 *
 * When [frame] is non-null it is folded into the hash via
 * `combineHash(seedHash, fnv1a64(frame.toLong()))`; otherwise the hash is used
 * as-is.
 */
private fun seededRandomFromHash(seedHash: Long, frame: Int?): Random {
    val combined = frame?.let { combineHash(seedHash, fnv1a64(it.toLong())) } ?: seedHash
    return Random(combined)
}
