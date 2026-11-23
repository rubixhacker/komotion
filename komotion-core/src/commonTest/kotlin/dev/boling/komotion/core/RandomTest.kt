package dev.boling.komotion.core

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class, ExperimentalKomotionApi::class)
class RandomTest {

    @Test
    fun `same string seed is deterministic`() {
        assertEquals(random("particle-1"), random("particle-1"))
    }

    @Test
    fun `same long seed is deterministic`() {
        assertEquals(random(42L), random(42L))
    }

    @Test
    fun `different seeds produce distinct values`() {
        assertNotEquals(random("particle-1"), random("particle-2"))
        assertNotEquals(random(42L), random(43L))
    }

    @Test
    fun `outputs are in range over many seeds`() {
        repeat(1000) { i ->
            val fromString = random("seed-$i")
            val fromLong = random(i.toLong())
            assertTrue(fromString in 0.0..<1.0, "string seed out of range: $fromString")
            assertTrue(fromLong in 0.0..<1.0, "long seed out of range: $fromLong")
        }
    }

    @Test
    fun `frame folding produces distinct values for the same seed`() = runComposeUiTest {
        val values = ArrayList<Double>(2)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                values.add(randomPerFrame("particle-1"))
            }
            CompositionLocalProvider(LocalFrame provides 43) {
                values.add(randomPerFrame("particle-1"))
            }
        }
        assertEquals(2, values.size)
        assertNotEquals(values[0], values[1])
    }

    @Test
    fun `frame folding is reproducible for the same seed and frame`() = runComposeUiTest {
        val first = ArrayList<Double>(2)
        val second = ArrayList<Double>(2)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                first.add(randomPerFrame("particle-1"))
                first.add(randomPerFrame(42L))
            }
            CompositionLocalProvider(LocalFrame provides 42) {
                second.add(randomPerFrame("particle-1"))
                second.add(randomPerFrame(42L))
            }
        }
        assertEquals(first, second)
    }

    @Test
    fun `randomInRange int bounds are inclusive over many seeds`() = runComposeUiTest {
        val range = 10..20
        repeat(1000) { i ->
            val fromString = randomInRange("seed-$i", range)
            val fromLong = randomInRange(i.toLong(), range)
            assertTrue(fromString in range, "string seed out of range: $fromString")
            assertTrue(fromLong in range, "long seed out of range: $fromLong")
        }
        val perFrameValues = ArrayList<Int>(4)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                perFrameValues.add(randomInRangePerFrame("seed-1", range))
                perFrameValues.add(randomInRangePerFrame(42L, range))
            }
            CompositionLocalProvider(LocalFrame provides 43) {
                perFrameValues.add(randomInRangePerFrame("seed-1", range))
                perFrameValues.add(randomInRangePerFrame(42L, range))
            }
        }
        perFrameValues.forEach { value ->
            assertTrue(value in range, "per-frame value out of range: $value")
        }
    }

    @Test
    fun `randomInRange int range covers both ends across many seeds`() {
        val range = 10..20
        val results = IntArray(2000)
        repeat(1000) { i ->
            results[i] = randomInRange("seed-$i", range)
            results[i + 1000] = randomInRange(i.toLong(), range)
        }
        assertTrue(results.any { it == range.first }, "range.first ${range.first} never drawn")
        assertTrue(results.any { it == range.last }, "range.last ${range.last} never drawn")
    }

    @Test
    fun `randomInRange float range is lower-inclusive upper-exclusive over many seeds`() = runComposeUiTest {
        val range = 1.0f..5.0f
        repeat(1000) { i ->
            val fromString = randomInRange("seed-$i", range)
            val fromLong = randomInRange(i.toLong(), range)
            assertTrue(
                fromString >= range.start && fromString < range.endInclusive,
                "string seed out of range: $fromString"
            )
            assertTrue(
                fromLong >= range.start && fromLong < range.endInclusive,
                "long seed out of range: $fromLong"
            )
        }
        val perFrameValues = ArrayList<Float>(4)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                perFrameValues.add(randomInRangePerFrame("seed-1", range))
                perFrameValues.add(randomInRangePerFrame(42L, range))
            }
            CompositionLocalProvider(LocalFrame provides 43) {
                perFrameValues.add(randomInRangePerFrame("seed-1", range))
                perFrameValues.add(randomInRangePerFrame(42L, range))
            }
        }
        perFrameValues.forEach { value ->
            assertTrue(
                value >= range.start && value < range.endInclusive,
                "per-frame value out of range: $value"
            )
        }
    }
}
