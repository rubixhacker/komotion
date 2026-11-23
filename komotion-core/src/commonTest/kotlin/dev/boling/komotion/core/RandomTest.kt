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
}
