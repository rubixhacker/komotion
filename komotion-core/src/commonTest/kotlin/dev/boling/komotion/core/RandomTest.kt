package dev.boling.komotion.core

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
    fun `pick returns an element from the list across many seeds`() {
        val list = listOf("red", "green", "blue", "yellow")
        repeat(200) { i ->
            assertTrue(list.contains(pick("seed-$i", list)), "string seed pick out of list: seed-$i")
            assertTrue(list.contains(pick(i.toLong(), list)), "long seed pick out of list: $i")
        }
        runComposeUiTest {
            val values = ArrayList<String>(2)
            setContent {
                CompositionLocalProvider(LocalFrame provides 42) {
                    values.add(pickPerFrame("seed-0", list))
                }
                CompositionLocalProvider(LocalFrame provides 43) {
                    values.add(pickPerFrame(0L, list))
                }
            }
            assertTrue(list.containsAll(values), "per-frame pick out of list: $values")
        }
    }

    @Test
    fun `pick is deterministic for the same seed`() {
        val list = listOf("red", "green", "blue", "yellow", "purple")
        repeat(100) { i ->
            assertEquals(pick("seed-$i", list), pick("seed-$i", list))
            assertEquals(pick(i.toLong(), list), pick(i.toLong(), list))
        }
        runComposeUiTest {
            val first = ArrayList<String>(2)
            val second = ArrayList<String>(2)
            setContent {
                CompositionLocalProvider(LocalFrame provides 42) {
                    first.add(pickPerFrame("seed-0", list))
                    first.add(pickPerFrame(0L, list))
                }
                CompositionLocalProvider(LocalFrame provides 42) {
                    second.add(pickPerFrame("seed-0", list))
                    second.add(pickPerFrame(0L, list))
                }
            }
            assertEquals(first, second)
        }
    }

    @Test
    fun `pick on an empty list throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> { pick("seed-0", emptyList<String>()) }
        assertFailsWith<IllegalArgumentException> { pick(0L, emptyList<String>()) }
        runComposeUiTest {
            setContent {
                CompositionLocalProvider(LocalFrame provides 42) {
                    assertFailsWith<IllegalArgumentException> {
                        pickPerFrame("seed-0", emptyList<String>())
                    }
                    assertFailsWith<IllegalArgumentException> {
                        pickPerFrame(0L, emptyList<String>())
                    }
                }
            }
        }
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

    @Test
    fun `empty int range is rejected with IllegalArgumentException`() {
        val empty = 10..9
        val stringError = assertFailsWith<IllegalArgumentException> { randomInRange("seed-1", empty) }
        assertTrue(stringError.message.orEmpty().contains("must not be empty"), "unexpected message: ${stringError.message}")
        val longError = assertFailsWith<IllegalArgumentException> { randomInRange(42L, empty) }
        assertTrue(longError.message.orEmpty().contains("must not be empty"), "unexpected message: ${longError.message}")
    }

    @Test
    fun `empty float range is rejected with IllegalArgumentException`() {
        val empty = 5.0f..1.0f
        val stringError = assertFailsWith<IllegalArgumentException> { randomInRange("seed-1", empty) }
        assertTrue(stringError.message.orEmpty().contains("must not be empty"), "unexpected message: ${stringError.message}")
        val longError = assertFailsWith<IllegalArgumentException> { randomInRange(42L, empty) }
        assertTrue(longError.message.orEmpty().contains("must not be empty"), "unexpected message: ${longError.message}")
    }

    @Test
    fun `empty range is rejected for per-frame overloads`() = runComposeUiTest {
        val emptyInt = 10..9
        val emptyFloat = 5.0f..1.0f
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                assertFailsWith<IllegalArgumentException> { randomInRangePerFrame("seed-1", emptyInt) }
                assertFailsWith<IllegalArgumentException> { randomInRangePerFrame(42L, emptyInt) }
                assertFailsWith<IllegalArgumentException> { randomInRangePerFrame("seed-1", emptyFloat) }
                assertFailsWith<IllegalArgumentException> { randomInRangePerFrame(42L, emptyFloat) }
            }
        }
    }

    @Test
    fun `single-point ranges return the single value`() {
        assertEquals(5, randomInRange("seed-1", 5..5))
        assertEquals(5, randomInRange(42L, 5..5))
        assertEquals(1.0f, randomInRange("seed-1", 1.0f..1.0f))
        assertEquals(1.0f, randomInRange(42L, 1.0f..1.0f))
    }

    @Test
    fun `randomInRangePerFrame is reproducible for the same seed and frame`() = runComposeUiTest {
        val intRange = 10..20
        val floatRange = 1.0f..5.0f
        val first = ArrayList<Any>(4)
        val second = ArrayList<Any>(4)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                first.add(randomInRangePerFrame("seed-1", intRange))
                first.add(randomInRangePerFrame(42L, intRange))
                first.add(randomInRangePerFrame("seed-1", floatRange))
                first.add(randomInRangePerFrame(42L, floatRange))
            }
            CompositionLocalProvider(LocalFrame provides 42) {
                second.add(randomInRangePerFrame("seed-1", intRange))
                second.add(randomInRangePerFrame(42L, intRange))
                second.add(randomInRangePerFrame("seed-1", floatRange))
                second.add(randomInRangePerFrame(42L, floatRange))
            }
        }
        assertEquals(first, second)
    }

    @Test
    fun `randomInRangePerFrame produces distinct values across frames`() = runComposeUiTest {
        val intRange = 0..1_000_000_000
        val floatRange = 0f..1_000_000_000f
        val frame42 = ArrayList<Any>(2)
        val frame43 = ArrayList<Any>(2)
        setContent {
            CompositionLocalProvider(LocalFrame provides 42) {
                frame42.add(randomInRangePerFrame("seed-1", intRange))
                frame42.add(randomInRangePerFrame("seed-1", floatRange))
            }
            CompositionLocalProvider(LocalFrame provides 43) {
                frame43.add(randomInRangePerFrame("seed-1", intRange))
                frame43.add(randomInRangePerFrame("seed-1", floatRange))
            }
        }
        assertNotEquals(frame42[0], frame43[0], "int per-frame value did not change across frames")
        assertNotEquals(frame42[1], frame43[1], "float per-frame value did not change across frames")
    }
}
