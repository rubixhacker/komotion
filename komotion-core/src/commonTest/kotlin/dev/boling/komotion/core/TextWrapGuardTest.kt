package dev.boling.komotion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TextWrapGuardTest {

    // Predictable measurer for deterministic tests: 1 char = 10px.
    private val tenPxPerChar: (String) -> Float = { it.length * 10f }

    @Test
    fun `ok report when every word fits`() {
        val report = checkTextFits(
            text = "Short words fit fine",
            maxWidthPx = 100f,
            measure = tenPxPerChar,
        )
        assertTrue(report.ok)
        assertTrue(report.overflowingWords.isEmpty())
        assertEquals(50f, report.widestWordPx) // "Short" is 5 chars
    }

    @Test
    fun `flags a single oversized word`() {
        val report = checkTextFits(
            text = "tiny combination tiny",
            maxWidthPx = 100f, // "combination" is 11 chars = 110px > 100
            measure = tenPxPerChar,
        )
        assertFalse(report.ok)
        assertEquals(listOf("combination"), report.overflowingWords)
        assertEquals(110f, report.widestWordPx)
    }

    @Test
    fun `dedupes repeated overflow words`() {
        val report = checkTextFits(
            text = "combination combination combination",
            maxWidthPx = 100f,
            measure = tenPxPerChar,
        )
        assertEquals(1, report.overflowingWords.size)
        assertEquals("combination", report.overflowingWords.single())
    }

    @Test
    fun `empty text is always ok`() {
        val report = checkTextFits(text = "   ", maxWidthPx = 50f, measure = tenPxPerChar)
        assertTrue(report.ok)
        assertEquals(0f, report.widestWordPx)
    }

    @Test
    fun `rejects non-positive maxWidth`() {
        assertFailsWith<IllegalArgumentException> {
            checkTextFits(text = "x", maxWidthPx = 0f, measure = tenPxPerChar)
        }
        assertFailsWith<IllegalArgumentException> {
            checkTextFits(text = "x", maxWidthPx = -1f, measure = tenPxPerChar)
        }
    }
}
