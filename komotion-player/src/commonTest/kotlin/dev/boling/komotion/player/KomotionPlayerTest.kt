package dev.boling.komotion.player

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.LocalFrame
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class)
class KomotionPlayerTest {

    private val testComposition = Composition(
        width = 100,
        height = 100,
        durationInFrames = 60,
        fps = 30,
    )

    @Test
    fun `starts at initialFrame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            KomotionPlayer(
                composition = testComposition,
                initialFrame = 15,
                autoPlay = false,
            ) {
                observedFrame = LocalFrame.current
            }
        }
        assertEquals(15, observedFrame)
    }

    @Test
    fun `skip-to-start sets frame to 0`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            KomotionPlayer(
                composition = testComposition,
                initialFrame = 30,
                autoPlay = false,
            ) {
                observedFrame = LocalFrame.current
            }
        }
        onNodeWithContentDescription("Skip to start").performClick()
        waitForIdle()
        assertEquals(0, observedFrame)
    }

    @Test
    fun `skip-to-end sets frame to last frame`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            KomotionPlayer(
                composition = testComposition,
                initialFrame = 0,
                autoPlay = false,
            ) {
                observedFrame = LocalFrame.current
            }
        }
        onNodeWithContentDescription("Skip to end").performClick()
        waitForIdle()
        assertEquals(59, observedFrame) // durationInFrames - 1
    }
}
