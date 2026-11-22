package dev.boling.komotion.core.internal

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class SeededRandomTest {

    private fun firstN(r: Random, n: Int): List<Long> {
        val out = ArrayList<Long>(n)
        repeat(n) { out.add(r.nextLong()) }
        return out
    }

    @Test
    fun `same seed and frame is deterministic`() {
        val a = firstN(seededRandom("particle-1", frame = 42), 16)
        val b = firstN(seededRandom("particle-1", frame = 42), 16)
        assertEquals(a, b)

        val c = firstN(seededRandom(7L, frame = 42), 16)
        val d = firstN(seededRandom(7L, frame = 42), 16)
        assertEquals(c, d)
    }

    @Test
    fun `different frames produce different streams for the same seed`() {
        val a = firstN(seededRandom("particle-1", frame = 42), 16)
        val b = firstN(seededRandom("particle-1", frame = 43), 16)
        assertNotEquals(a, b)
    }

    @Test
    fun `frame null is distinct from frame 0`() {
        val a = firstN(seededRandom("particle-1", frame = null), 16)
        val b = firstN(seededRandom("particle-1", frame = 0), 16)
        assertNotEquals(a, b)
    }

    @Test
    fun `string seed 42 and long seed 42L produce distinct streams`() {
        val a = firstN(seededRandom("42"), 16)
        val b = firstN(seededRandom(42L), 16)
        assertNotEquals(a, b)
    }
}
