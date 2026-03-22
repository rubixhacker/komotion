package dev.boling.komotion.core

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

@OptIn(ExperimentalTestApi::class)
class SequenceTest {

    @Test
    fun `in-window child receives local frame offset from global frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 35) {
                Sequence(from = 30, durationInFrames = 60) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(5, observedFrame) // 35 - 30 = 5
    }

    @Test
    fun `first frame in window receives local frame 0`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            CompositionLocalProvider(LocalFrame provides 30) {
                Sequence(from = 30, durationInFrames = 60) {
                    observedFrame = LocalFrame.current
                }
            }
        }
        assertEquals(0, observedFrame)
    }

    @Test
    fun `out-of-window before start does not call content`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            CompositionLocalProvider(LocalFrame provides 10) {
                Sequence(from = 30, durationInFrames = 60) {
                    contentCalled = true
                }
            }
        }
        assertFalse(contentCalled)
    }

    @Test
    fun `out-of-window after end does not call content`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            CompositionLocalProvider(LocalFrame provides 100) {
                Sequence(from = 30, durationInFrames = 60) { // window: 30..89
                    contentCalled = true
                }
            }
        }
        assertFalse(contentCalled)
    }
}
