package dev.boling.komotion.core

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class FontDataValidationTest {

    @Test
    fun `sfnt header passes validation`() {
        requireFontData("font.ttf", byteArrayOf(0, 1, 0, 0) + ByteArray(8))
    }

    @Test
    fun `woff header passes validation`() {
        requireFontData("font.woff", "wOFF".encodeToByteArray() + ByteArray(8))
    }

    @Test
    fun `woff2 header passes validation`() {
        requireFontData("font.woff2", "wOFF2".encodeToByteArray() + ByteArray(7))
    }

    @Test
    fun `data smaller than the minimum font size throws`() {
        assertFailsWith<IllegalArgumentException> {
            requireFontData("font.ttf", byteArrayOf(0, 1, 0, 0))
        }
    }

    @Test
    fun `empty data throws`() {
        assertFailsWith<IllegalArgumentException> {
            requireFontData("font.ttf", ByteArray(0))
        }
    }

    @Test
    fun `data without a font header throws`() {
        assertFailsWith<IllegalArgumentException> {
            requireFontData("font.bin", ByteArray(12) { 42 })
        }
    }

    @Test
    fun `wrong sfnt version throws`() {
        assertFailsWith<IllegalArgumentException> {
            requireFontData("font.ttf", byteArrayOf(0, 2, 0, 0) + ByteArray(8))
        }
    }

    @Test
    fun `validation message includes the path`() {
        val failure = runCatching {
            requireFontData("font.bin", ByteArray(12) { 42 })
        }.exceptionOrNull()
        assertTrue(failure?.message?.contains("font.bin") == true)
    }
}
