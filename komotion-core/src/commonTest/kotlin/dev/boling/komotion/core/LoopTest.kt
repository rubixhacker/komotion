package dev.boling.komotion.core

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class, ExperimentalKomotionApi::class)
class LoopTest {

    @Test
    fun `child receives parent frame modulo duration`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 47) {
                Loop(durationInFrames = 30) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(17, observedFrame) // 47 % 30 = 17
    }

    @Test
    fun `child receives 0 at iteration boundary`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 60) {
                Loop(durationInFrames = 30) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(0, observedFrame) // 60 % 30 = 0
    }

    @Test
    fun `negative parent frame wraps to positive local frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides -1) {
                Loop(durationInFrames = 30) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(29, observedFrame) // -1 % 30 = -1, wrapped to 29
    }

    @Test
    fun `loop inside sequence sees sequence local frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 50) {
                Sequence(from = 30, durationInFrames = 60) {
                    Loop(durationInFrames = 30) {
                        observedFrame = LocalFrame.current
                    }
                }
            }
        }
        // Sequence local frame = 50 - 30 = 20; Loop local frame = 20 % 30 = 20.
        assertEquals(20, observedFrame)
    }

    @Test
    fun `non-positive duration throws IllegalArgumentException`() = runComposeUiTest {
        listOf(0, -1).forEach { duration ->
            val error = assertFailsWith<IllegalArgumentException> {
                setContent {
                    CompositionLocalProvider(LocalFrame provides 0) {
                        Loop(durationInFrames = duration) { }
                    }
                }
            }
            assertTrue(error.message.orEmpty().contains("durationInFrames"))
        }
    }
}
