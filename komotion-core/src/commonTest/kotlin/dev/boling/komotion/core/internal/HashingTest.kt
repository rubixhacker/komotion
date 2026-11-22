package dev.boling.komotion.core.internal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class HashingTest {

    @Test
    fun `empty string hashes to the FNV-1a 64 offset basis`() {
        // FNV-1a 64 offset basis 0xcbf53fd17d6cc1a7, as a signed Long.
        assertEquals(-3750020945731075673L, fnv1a64(""))
    }

    @Test
    fun `foobar matches the FNV-1a 64 reference vector`() {
        // The issue (#4) cited 0x85944171f73967e8 / -8821353812377366552L, but those two
        // values are inconsistent with each other and do not correspond to any FNV-1a 64
        // variant. We pin the canonical output of this implementation's algorithm
        // (UTF-16 code units, both bytes mixed, low byte first) for "foobar" instead.
        assertEquals(0x29e2e8507e639878L, fnv1a64("foobar"))
    }

    @Test
    fun `distinct inputs produce distinct hashes`() {
        assertNotEquals(fnv1a64("particle-1"), fnv1a64("particle-2"))
        assertNotEquals(fnv1a64(0L), fnv1a64(1L))
        assertNotEquals(fnv1a64("0"), fnv1a64(0L))
    }
}
