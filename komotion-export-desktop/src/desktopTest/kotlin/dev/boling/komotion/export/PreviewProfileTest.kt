package dev.boling.komotion.export

import dev.boling.komotion.core.Composition
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PreviewProfileTest {

    @Test
    fun `default profile downscales 1080p 30fps to 240p 5fps`() {
        val src = Composition(width = 1920, height = 1080, durationInFrames = 300, fps = 30)
        val out = PreviewProfile.Default.apply(src)
        assertEquals(240, out.height)
        assertEquals(5, out.fps)
        // 1920 * (240/1080) = 426.666... -> 426 (even)
        assertEquals(426, out.width)
        assertEquals(0, out.width % 2)
        assertEquals(0, out.height % 2)
    }

    @Test
    fun `duration in seconds is preserved when fps is reduced`() {
        // 300 frames @ 30fps = 10s -> at 5fps that's 50 frames
        val src = Composition(1920, 1080, durationInFrames = 300, fps = 30)
        val out = PreviewProfile.Default.apply(src)
        assertEquals(50, out.durationInFrames)
    }

    @Test
    fun `width is forced to even number for yuv420p`() {
        // height 240 -> scale = 240/720 = 0.333..., width = 1281 -> 426 (even)
        val src = Composition(width = 1281, height = 720, durationInFrames = 60, fps = 30)
        val out = PreviewProfile(targetHeight = 240, fps = 5).apply(src)
        assertEquals(0, out.width % 2)
    }

    @Test
    fun `rejects non-positive parameters`() {
        assertFailsWith<IllegalArgumentException> { PreviewProfile(targetHeight = 0) }
        assertFailsWith<IllegalArgumentException> { PreviewProfile(fps = 0) }
    }

    @Test
    fun `tiny composition still produces at least one frame`() {
        val src = Composition(2, 2, durationInFrames = 1, fps = 30)
        val out = PreviewProfile.Default.apply(src)
        assertTrue(out.durationInFrames >= 1)
        assertTrue(out.width >= 2)
        assertTrue(out.height >= 2)
    }
}
