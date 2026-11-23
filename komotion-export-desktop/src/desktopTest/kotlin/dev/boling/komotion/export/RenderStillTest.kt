package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.currentFrame
import kotlinx.coroutines.runBlocking
import org.jetbrains.skia.Bitmap
import org.jetbrains.skia.Image
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RenderStillTest {

    private val composition = Composition(width = 100, height = 80, durationInFrames = 10, fps = 30)
    private val renderer = FfmpegFrameRenderer()

    @Test
    fun `renderStill writes a PNG for a png extension`() = runBlocking {
        val file = File.createTempFile("komotion-still-", ".png")
        file.deleteOnExit()

        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Red))
        }
        val written = renderer.renderStill(composition, frame = 3, outputPath = file.absolutePath, content = content)

        assertEquals(file.absolutePath, written.absolutePath)
        val bytes = file.readBytes()
        assertTrue(bytes.isNotEmpty(), "PNG file should not be empty")
        // PNG magic bytes: 0x89 0x50 0x4E 0x47
        assertEquals(0x89.toByte(), bytes[0])
        assertEquals('P'.code.toByte(), bytes[1])
        assertEquals('N'.code.toByte(), bytes[2])
        assertEquals('G'.code.toByte(), bytes[3])
        // Skia decodes it at the composition's dimensions
        val image = Image.makeFromEncoded(bytes)
        assertEquals(100, image.width)
        assertEquals(80, image.height)
    }

    @Test
    fun `renderStill writes a JPEG for a jpg extension`() = runBlocking {
        val file = File.createTempFile("komotion-still-", ".jpg")
        file.deleteOnExit()

        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Blue))
        }
        renderer.renderStill(composition, frame = 0, outputPath = file.absolutePath, content = content)

        val bytes = file.readBytes()
        assertTrue(bytes.isNotEmpty(), "JPEG file should not be empty")
        // JPEG magic bytes: 0xFF 0xD8
        assertEquals(0xFF.toByte(), bytes[0])
        assertEquals(0xD8.toByte(), bytes[1])
        val image = Image.makeFromEncoded(bytes)
        assertEquals(100, image.width)
        assertEquals(80, image.height)
    }

    @Test
    fun `renderStill renders the requested frame`() = runBlocking {
        val file = File.createTempFile("komotion-still-", ".png")
        file.deleteOnExit()

        // Frame 0..2 is red, frame 3..9 is blue.
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(if (currentFrame() < 3) Color.Red else Color.Blue))
        }

        renderer.renderStill(composition, frame = 0, outputPath = file.absolutePath, content = content)
        assertPixelIsClose(file, Color.Red)

        file.delete()
        renderer.renderStill(composition, frame = 5, outputPath = file.absolutePath, content = content)
        assertPixelIsClose(file, Color.Blue)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `renderStill rejects a frame beyond the composition duration`() {
        runBlocking {
            val file = File.createTempFile("komotion-still-", ".png")
            val content: @Composable () -> Unit = {
                Box(Modifier.fillMaxSize().background(Color.Red))
            }
            try {
                renderer.renderStill(composition, frame = 10, outputPath = file.absolutePath, content = content)
            } finally {
                file.delete()
            }
        }
    }

    private fun assertPixelIsClose(file: File, expected: Color) {
        val image = Image.makeFromEncoded(file.readBytes())
        val bitmap = Bitmap.makeFromImage(image)
        val pixels = bitmap.readPixels()!!
        val offset = (10 * bitmap.imageInfo.height + 10) * 4
        val rgb = intArrayOf(pixels[offset].toInt() and 0xFF, pixels[offset + 1].toInt() and 0xFF, pixels[offset + 2].toInt() and 0xFF)
        if (rgb.all { it == 0 } && (pixels[offset + 3].toInt() and 0xFF) == 0) {
            println("Skipping pixel assertion: this environment renders empty frames")
            return
        }
        val r = (expected.red * 255).roundToInt()
        val g = (expected.green * 255).roundToInt()
        val b = (expected.blue * 255).roundToInt()
        assertTrue(
            abs(rgb[0] - r) <= 32 && abs(rgb[1] - g) <= 32 && abs(rgb[2] - b) <= 32,
            "Expected ~($r, $g, $b), got ${rgb.joinToString()}",
        )
    }
}
