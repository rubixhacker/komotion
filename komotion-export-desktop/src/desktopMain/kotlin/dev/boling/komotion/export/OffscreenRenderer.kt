package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.LocalComposition
import dev.boling.komotion.core.LocalFrame
import org.jetbrains.skia.EncodedImageFormat

/**
 * Renders composable frames to PNG byte arrays using Compose's [ImageComposeScene].
 *
 * One OffscreenRenderer is created per render job. The scene is created in init
 * and closed in [close] (implements [AutoCloseable]).
 */
class OffscreenRenderer(private val composition: Composition) : AutoCloseable {

    private val frameState = mutableStateOf(0)

    @Volatile
    private var currentContent: (@Composable () -> Unit)? = null

    private val scene: ImageComposeScene = ImageComposeScene(
        width = composition.width,
        height = composition.height,
        density = Density(1f),
    ) {
        CompositionLocalProvider(
            LocalFrame provides frameState.value,
            LocalComposition provides composition,
        ) {
            currentContent?.invoke()
        }
    }

    /**
     * Renders [content] at [frame] and returns PNG-encoded bytes.
     */
    fun renderFrame(frame: Int, content: @Composable () -> Unit): ByteArray {
        setRenderMode(true)
        currentContent = content
        frameState.value = frame
        val nanoTime = frame * 1_000_000_000L / composition.fps
        val image = scene.render(nanoTime)
        return image.encodeToData(EncodedImageFormat.PNG)!!.bytes
    }

    /**
     * Renders [content] at [frame] and returns raw BGRA pixel bytes.
     * Skips PNG encoding — faster than [renderFrame] for piped output.
     */
    fun renderFrameRaw(frame: Int, content: @Composable () -> Unit): ByteArray {
        setRenderMode(true)
        currentContent = content
        frameState.value = frame
        val nanoTime = frame * 1_000_000_000L / composition.fps
        val image = scene.render(nanoTime)
        return image.peekPixels()!!.buffer.bytes
    }

    override fun close() {
        setRenderMode(false)
        scene.close()
    }
}
