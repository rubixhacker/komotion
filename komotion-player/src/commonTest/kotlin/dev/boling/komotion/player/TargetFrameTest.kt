package dev.boling.komotion.player

import kotlin.test.Test
import kotlin.test.assertEquals

class TargetFrameTest {

    @Test
    fun `zero elapsed time starts at the window start`() {
        assertEquals(0, targetFrame(0, 30, 1f, 0, 59, true))
        assertEquals(30, targetFrame(0, 30, 1f, 30, 50, true))
    }

    @Test
    fun `normal rate advances one frame per fps tick`() {
        assertEquals(30, targetFrame(1000, 30, 1f, 0, 59, true))
        assertEquals(58, targetFrame(1966, 30, 1f, 0, 59, true))
    }

    @Test
    fun `loop wraps around at the end of the window`() {
        // 60 elapsed frames at 30 fps with a 60-frame window wraps to 0.
        assertEquals(0, targetFrame(2000, 30, 1f, 0, 59, true))
        // A 21-frame window wraps 30 elapsed frames to windowStart + 9.
        assertEquals(39, targetFrame(1000, 30, 1f, 30, 50, true))
    }

    @Test
    fun `without loop the frame clamps at the window end`() {
        assertEquals(59, targetFrame(2000, 30, 1f, 0, 59, false))
        assertEquals(50, targetFrame(1000, 30, 1f, 30, 50, false))
    }

    @Test
    fun `playbackRate scales the speed`() {
        // 2x: 60 elapsed frames in one second.
        assertEquals(0, targetFrame(1000, 30, 2f, 0, 59, true))
        assertEquals(59, targetFrame(1000, 30, 2f, 0, 59, false))
        // 0.5x: 15 elapsed frames in one second.
        assertEquals(15, targetFrame(1000, 30, 0.5f, 0, 59, false))
        // 2x in a 21-frame window: 60 % 21 = 18.
        assertEquals(48, targetFrame(1000, 30, 2f, 30, 50, true))
    }

    @Test
    fun `invalid arguments are rejected`() {
        kotlin.test.assertFails { targetFrame(0, 0, 1f, 0, 59, true) }
        kotlin.test.assertFails { targetFrame(0, 30, 0f, 0, 59, true) }
        kotlin.test.assertFails { targetFrame(0, 30, 1f, 59, 0, true) }
    }
}
