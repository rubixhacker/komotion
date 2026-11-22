package dev.boling.komotion.core.internal

/**
 * FNV-1a 64-bit hashing for deterministic seed derivation.
 *
 * The deepest layer of the seeded-random stack: `Hashing` → `SeededRandom`
 * → public Random API. Pure data-to-data logic with no Compose dependency.
 */

/** FNV-1a 64 offset basis (0xcbf53fd17d6cc1a7). */
private const val FNV_OFFSET_BASIS: Long = -3750020945731075673L

/** FNV-1a 64 prime. */
private const val FNV_PRIME: Long = 0x00000100000001B3L

/**
 * FNV-1a 64-bit hash of [s].
 *
 * Iterates the string's 16-bit code units, mixing both bytes of each unit
 * (low byte first) so non-ASCII seeds contribute fully.
 */
internal fun fnv1a64(s: String): Long {
    var hash = FNV_OFFSET_BASIS
    for (c in s) {
        val unit = c.code.toLong()
        hash = (hash xor (unit and 0xFFL)) * FNV_PRIME
        hash = (hash xor ((unit shr 8) and 0xFFL)) * FNV_PRIME
    }
    return hash
}

/**
 * FNV-1a 64-bit hash of [n].
 *
 * Folds the eight bytes of [n] little-endian, so all 64 bits of the value
 * contribute — unlike `n.hashCode().toLong()`, which collapses to 32 bits.
 */
internal fun fnv1a64(n: Long): Long {
    var hash = FNV_OFFSET_BASIS
    for (i in 0 until 8) {
        val byte = (n shr (i * 8)) and 0xFFL
        hash = (hash xor byte) * FNV_PRIME
    }
    return hash
}

/**
 * Combines two FNV-1a 64 hashes by XORing and re-mixing through the FNV prime.
 *
 * Used to fold a per-frame component into a seed hash without re-hashing the
 * seed string.
 */
internal fun combineHash(a: Long, b: Long): Long {
    return (a xor b) * FNV_PRIME
}
