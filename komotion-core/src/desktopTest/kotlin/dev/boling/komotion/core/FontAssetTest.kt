package dev.boling.komotion.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalKomotionApi::class)
class FontAssetTest {

    @Test
    fun `loads font data from a file`() {
        val bytes = ByteArray(64) { it.toByte() }
        bytes[0] = 0
        bytes[1] = 1
        bytes[2] = 0
        bytes[3] = 0 // SFNT (TTF/OTF) header
        val file = File.createTempFile("komotion-font-test-", ".ttf")
        file.writeBytes(bytes)
        file.deleteOnExit()

        val asset = FontAsset(file.absolutePath)

        assertTrue(asset.data.contentEquals(bytes))
        assertEquals(file.absolutePath, asset.path)
    }

    @Test
    fun `missing file throws`() {
        assertFailsWith<IllegalArgumentException> {
            FontAsset("/nonexistent/komotion-font.ttf")
        }
    }

    @Test
    fun `empty file throws`() {
        val file = File.createTempFile("komotion-font-empty-", ".ttf")
        file.deleteOnExit()

        assertFailsWith<IllegalArgumentException> {
            FontAsset(file.absolutePath)
        }
    }

    @Test
    fun `data without a font header throws`() {
        val file = File.createTempFile("komotion-font-garbage-", ".bin")
        file.writeBytes(ByteArray(64) { 42 })
        file.deleteOnExit()

        assertFailsWith<IllegalArgumentException> {
            FontAsset(file.absolutePath)
        }
    }
}
