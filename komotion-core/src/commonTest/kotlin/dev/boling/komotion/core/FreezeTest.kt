package dev.boling.komotion.core

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class, ExperimentalKomotionApi::class)
class FreezeTest {

    @Test
    fun `child receives the frozen frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 40) {
                Freeze(frame = 7) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(7, observedFrame)
    }

    @Test
    fun `freeze ignores parent frame regardless of value`() = runComposeUiTest {
        var observedFirst = -1
        var observedSecond = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 40) {
                Freeze(frame = 5) {
                    observedFirst = LocalFrame.current
                }
                Freeze(frame = 99) {
                    observedSecond = LocalFrame.current
                }
            }
        }
        assertEquals(5, observedFirst)
        assertEquals(99, observedSecond)
    }

    @Test
    fun `freeze inside sequence uses absolute frame not sequence-local frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 35) {
                Sequence(from = 30, durationInFrames = 60) {
                    // Sequence would give LocalFrame 5 here (35 - 30).
                    Freeze(frame = 15) {
                        observedFrame = LocalFrame.current
                    }
                }
            }
        }
        assertEquals(15, observedFrame)
    }

    @Test
    fun `negative frame passes through without clamping`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 40) {
                Freeze(frame = -5) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(-5, observedFrame)
    }
}
