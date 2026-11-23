package dev.boling.komotion.captions

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CaptionTest {

    @Test
    fun `activeCaptionAt covers startFrame and excludes endFrame`() {
        val captions = listOf(
            Caption("A", 0, 30),
            Caption("B", 30, 60),
        )
        assertEquals("A", activeCaptionAt(captions, 0)?.text)
        assertEquals("A", activeCaptionAt(captions, 29)?.text)
        assertEquals("B", activeCaptionAt(captions, 30)?.text)
        assertEquals("B", activeCaptionAt(captions, 59)?.text)
        assertNull(activeCaptionAt(captions, 60))
    }

    @Test
    fun `activeCaptionAt returns null outside all cues`() {
        val captions = listOf(Caption("A", 10, 20))
        assertNull(activeCaptionAt(captions, 0))
        assertNull(activeCaptionAt(captions, 9))
        assertNull(activeCaptionAt(captions, 20))
        assertNull(activeCaptionAt(captions, 21))
    }

    @Test
    fun `activeCaptionAt returns the first overlapping cue`() {
        val captions = listOf(
            Caption("A", 0, 40),
            Caption("B", 10, 20),
        )
        assertEquals("A", activeCaptionAt(captions, 15)?.text)
    }

    @Test
    fun `activeCaptionAt returns null for an empty list`() {
        assertNull(activeCaptionAt(emptyList(), 5))
    }
}
