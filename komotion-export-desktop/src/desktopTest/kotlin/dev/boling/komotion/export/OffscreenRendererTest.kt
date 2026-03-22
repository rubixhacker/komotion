package dev.boling.komotion.export

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertTrue

class OffscreenRendererTest {

    @Test
    fun `renders a frame to non-empty PNG bytes`() = runBlocking {
        val composition = Composition(width = 100, height = 100, durationInFrames = 1, fps = 30)
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize().background(Color.Red))
        }
        val renderer = OffscreenRenderer(composition)
        val pngBytes = renderer.use { it.renderFrame(frame = 0, content = content) }
        assertTrue(pngBytes.isNotEmpty(), "PNG bytes should not be empty")
        // PNG magic bytes: 0x89 0x50 0x4E 0x47
        assertTrue(pngBytes[0] == 0x89.toByte())
        assertTrue(pngBytes[1] == 0x50.toByte()) // 'P'
        assertTrue(pngBytes[2] == 0x4E.toByte()) // 'N'
        assertTrue(pngBytes[3] == 0x47.toByte()) // 'G'
    }
}
