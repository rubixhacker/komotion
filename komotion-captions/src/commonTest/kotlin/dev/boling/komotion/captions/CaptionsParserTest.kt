package dev.boling.komotion.captions

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CaptionsParserTest {

    // SRT

    @Test
    fun `srt parses a single cue`() {
        val text = "1\n00:00:00,000 --> 00:00:02,000\nHello"
        assertEquals(listOf(Caption("Hello", 0, 60)), parseSrt(text, fps = 30))
    }

    @Test
    fun `srt parses multi-line cue text`() {
        val text = "1\n00:00:00,000 --> 00:00:02,000\nLine one\nLine two"
        assertEquals(listOf(Caption("Line one\nLine two", 0, 60)), parseSrt(text, fps = 30))
    }

    @Test
    fun `srt parses multiple cues separated by blank lines`() {
        val text = "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:02,000 --> 00:00:05,000\nSecond"
        assertEquals(
            listOf(
                Caption("First", 0, 60),
                Caption("Second", 60, 150),
            ),
            parseSrt(text, fps = 30),
        )
    }

    @Test
    fun `srt tolerates extra blank lines between cues`() {
        val text = "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n\n\n2\n00:00:02,000 --> 00:00:05,000\nSecond"
        assertEquals(2, parseSrt(text, fps = 30).size)
    }

    @Test
    fun `srt converts milliseconds to frames using fps`() {
        val text = "1\n00:00:00,100 --> 00:00:01,000\nA"
        assertEquals(listOf(Caption("A", 3, 30)), parseSrt(text, fps = 30))
        assertEquals(listOf(Caption("A", 2, 25)), parseSrt(text, fps = 25))
    }

    @Test
    fun `srt accepts a dot millisecond separator`() {
        val text = "1\n00:00:00.500 --> 00:00:01.000\nA"
        assertEquals(listOf(Caption("A", 15, 30)), parseSrt(text, fps = 30))
    }

    @Test
    fun `srt rejects a missing index line`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseSrt("00:00:00,000 --> 00:00:02,000\nHello", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("index"), "unexpected message: ${error.message}")
    }

    @Test
    fun `srt rejects a malformed timestamp line`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseSrt("1\n00:00:00,000 -- 00:00:02,000\nHello", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("timestamp"), "unexpected message: ${error.message}")
    }

    @Test
    fun `srt rejects a cue that ends before it starts`() {
        assertFailsWith<IllegalArgumentException> {
            parseSrt("1\n00:00:02,000 --> 00:00:00,000\nHello", fps = 30)
        }
    }

    @Test
    fun `srt rejects a cue with no text`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseSrt("1\n00:00:00,000 --> 00:00:02,000", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("text"), "unexpected message: ${error.message}")
    }

    @Test
    fun `srt rejects an empty file`() {
        assertFailsWith<IllegalArgumentException> { parseSrt("", fps = 30) }
        assertFailsWith<IllegalArgumentException> { parseSrt("   \n\n  ", fps = 30) }
    }

    @Test
    fun `srt rejects a non-positive fps`() {
        val text = "1\n00:00:00,000 --> 00:00:02,000\nHello"
        assertFailsWith<IllegalArgumentException> { parseSrt(text, fps = 0) }
        assertFailsWith<IllegalArgumentException> { parseSrt(text, fps = -1) }
    }

    // WebVTT

    @Test
    fun `vtt parses a cue without an identifier`() {
        val text = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello"
        assertEquals(listOf(Caption("Hello", 0, 60)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt parses a cue with an identifier`() {
        val text = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello"
        assertEquals(listOf(Caption("Hello", 0, 60)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt skips the file identifier line`() {
        val text = "WEBVTT\nen-US\n\n00:00:00.000 --> 00:00:02.000\nHello"
        assertEquals(listOf(Caption("Hello", 0, 60)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt skips a numeric file identifier line`() {
        val text = "WEBVTT\n12345\n\n00:00:00.000 --> 00:00:02.000\nHello"
        assertEquals(listOf(Caption("Hello", 0, 60)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt parses multi-line cue text`() {
        val text = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nLine one\nLine two"
        assertEquals(listOf(Caption("Line one\nLine two", 0, 60)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt parses multiple cues`() {
        val text = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nFirst\n\n2\n00:00:02.000 --> 00:00:05.000\nSecond"
        assertEquals(
            listOf(
                Caption("First", 0, 60),
                Caption("Second", 60, 150),
            ),
            parseVtt(text, fps = 30),
        )
    }

    @Test
    fun `vtt converts milliseconds to frames using fps`() {
        val text = "WEBVTT\n\n00:00:00.100 --> 00:00:01.000\nA"
        assertEquals(listOf(Caption("A", 3, 30)), parseVtt(text, fps = 30))
        assertEquals(listOf(Caption("A", 2, 25)), parseVtt(text, fps = 25))
    }

    @Test
    fun `vtt accepts a comma millisecond separator`() {
        val text = "WEBVTT\n\n00:00:00,500 --> 00:00:01,000\nA"
        assertEquals(listOf(Caption("A", 15, 30)), parseVtt(text, fps = 30))
    }

    @Test
    fun `vtt requires the WEBVTT header`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseVtt("1\n00:00:00.000 --> 00:00:02.000\nHello", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("WEBVTT"), "unexpected message: ${error.message}")
    }

    @Test
    fun `vtt rejects a malformed timestamp line`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseVtt("WEBVTT\n\n00:00:00.000 -- 00:00:02.000\nHello", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("timestamp"), "unexpected message: ${error.message}")
    }

    @Test
    fun `vtt rejects a cue with no text`() {
        val error = assertFailsWith<IllegalArgumentException> {
            parseVtt("WEBVTT\n\n00:00:00.000 --> 00:00:02.000", fps = 30)
        }
        assertTrue(error.message.orEmpty().contains("text"), "unexpected message: ${error.message}")
    }

    @Test
    fun `vtt rejects an empty file`() {
        assertFailsWith<IllegalArgumentException> { parseVtt("", fps = 30) }
    }

    @Test
    fun `vtt rejects a non-positive fps`() {
        val text = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello"
        assertFailsWith<IllegalArgumentException> { parseVtt(text, fps = 0) }
        assertFailsWith<IllegalArgumentException> { parseVtt(text, fps = -1) }
    }

    // Auto-detection

    @Test
    fun `parseCaptions auto-detects the format`() {
        val srt = "1\n00:00:00,000 --> 00:00:02,000\nHello"
        val vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello"
        assertEquals(parseSrt(srt, 30), parseCaptions(srt, 30))
        assertEquals(parseVtt(vtt, 30), parseCaptions(vtt, 30))
    }

    @Test
    fun `parseCaptions rejects an empty file`() {
        assertFailsWith<IllegalArgumentException> { parseCaptions("", fps = 30) }
    }
}
