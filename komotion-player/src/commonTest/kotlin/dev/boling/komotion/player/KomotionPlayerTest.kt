package dev.boling.komotion.player

import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyPress
import androidx.compose.ui.test.runComposeUiTest
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.CompositionEntry
import dev.boling.komotion.core.CompositionRegistry
import dev.boling.komotion.core.LocalFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class KomotionPlayerTest {

    private val testComposition = Composition(
        width = 100,
        height = 100,
        durationInFrames = 60,
        fps = 30,
    )

    @OptIn(InternalComposeUiApi::class)
    private fun spaceKeyEvent(): KeyEvent = KeyEvent(Key.Spacebar, KeyEventType.KeyDown)

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

    @Test
    fun `inFrame and outFrame restrict playback to a section`() = runComposeUiTest {
        var observedFrame = -1
        setContent {
            KomotionPlayer(
                composition = testComposition,
                initialFrame = 40,
                inFrame = 30,
                outFrame = 50,
                autoPlay = false,
            ) {
                observedFrame = LocalFrame.current
            }
        }
        // Skipping to the end of the composition stays inside the window.
        onNodeWithContentDescription("Skip to end").performClick()
        waitForIdle()
        assertEquals(50, observedFrame)
        // Skipping to the start of the composition stays inside the window.
        onNodeWithContentDescription("Skip to start").performClick()
        waitForIdle()
        assertEquals(30, observedFrame)
    }

    @Test
    fun `playbackRate is exposed in the controller state`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        setContent {
            KomotionPlayer(
                composition = testComposition,
                controller = controller,
                autoPlay = false,
                playbackRate = 2f,
            ) {
                LocalFrame.current
            }
        }
        waitForIdle()
        assertEquals(2f, controller.state.value.playbackRate)
    }

    @Test
    fun `controls false hides the control bar`() = runComposeUiTest {
        setContent {
            KomotionPlayer(
                composition = testComposition,
                autoPlay = false,
                controls = false,
            ) {
                LocalFrame.current
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Skip to start").assertDoesNotExist()
        onNodeWithContentDescription("Play").assertDoesNotExist()
    }

    @Test
    fun `space toggles playback when controls are enabled`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        setContent {
            KomotionPlayer(
                composition = testComposition,
                controller = controller,
                autoPlay = false,
            ) {
                LocalFrame.current
            }
        }
        waitForIdle()
        assertFalse(controller.state.value.isPlaying)

        // Clicking the play button focuses the player and starts playback.
        onNodeWithContentDescription("Play").performClick()
        waitForIdle()
        assertTrue(controller.state.value.isPlaying)

        // Space pauses playback.
        onNodeWithContentDescription("Pause").performKeyPress(spaceKeyEvent())
        waitForIdle()
        assertFalse(controller.state.value.isPlaying)

        // Space starts playback again.
        onNodeWithContentDescription("Play").performKeyPress(spaceKeyEvent())
        waitForIdle()
        assertTrue(controller.state.value.isPlaying)
    }

    @Test
    fun `a registry entry renders with its props`() = runComposeUiTest {
        data class TitleProps(val title: String)

        var observed: TitleProps? = null
        val entry = CompositionEntry(
            id = "title",
            composition = testComposition,
            defaultProps = TitleProps("default"),
            content = { props -> observed = props },
        )
        val registry = CompositionRegistry(listOf(entry))

        setContent {
            KomotionPlayer(
                entry = registry.require<TitleProps>("title"),
                autoPlay = false,
            )
        }
        waitForIdle()
        assertIs<TitleProps>(observed)
        assertEquals("default", observed.title)
    }

    @Test
    fun `a registry entry receives explicit props when provided`() = runComposeUiTest {
        data class TitleProps(val title: String)

        var observed: TitleProps? = null
        val entry = CompositionEntry(
            id = "title",
            composition = testComposition,
            defaultProps = TitleProps("default"),
            content = { props -> observed = props },
        )
        val registry = CompositionRegistry(listOf(entry))

        setContent {
            KomotionPlayer(
                entry = registry.require<TitleProps>("title"),
                props = TitleProps("custom"),
                autoPlay = false,
            )
        }
        waitForIdle()
        assertIs<TitleProps>(observed)
        assertEquals("custom", observed.title)
    }
}
