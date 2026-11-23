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
}
