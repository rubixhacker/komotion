package dev.boling.komotion.player

import app.cash.turbine.test
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.LocalFrame
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class KomotionPlayerControllerTest {

    private val testComposition = Composition(
        width = 100,
        height = 100,
        durationInFrames = 60,
        fps = 30,
    )

    @Test
    fun `state reflects the initial state`() {
        val controller = KomotionPlayerController(KomotionPlayerState(frame = 5, isPlaying = true, loop = false))
        assertEquals(5, controller.state.value.frame)
        assertTrue(controller.state.value.isPlaying)
        assertFalse(controller.state.value.loop)
    }

    @Test
    fun `controller drives the player and events fire for play pause and seek`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        coroutineScope {
            val subscribed = CompletableDeferred<Unit>()
            val job = launch {
                controller.events.test {
                    subscribed.complete(Unit)
                    assertEquals(KomotionPlayerEvent.Play, awaitItem())
                    assertEquals(KomotionPlayerEvent.Pause, awaitItem())
                    assertEquals(KomotionPlayerEvent.Seeked, awaitItem())
                    assertEquals(KomotionPlayerEvent.FrameUpdate(30), awaitItem())
                }
            }
            subscribed.await()

            setContent {
                KomotionPlayer(composition = testComposition, controller = controller, autoPlay = false) {
                    LocalFrame.current
                }
            }
            awaitIdle()

            controller.play()
            awaitIdle()
            controller.pause()
            awaitIdle()
            controller.seekTo(30)
            awaitIdle()

            assertEquals(30, controller.state.value.frame)
            assertFalse(controller.state.value.isPlaying)
            job.cancel()
        }
    }

    @Test
    fun `toggle starts playback when paused`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        coroutineScope {
            val subscribed = CompletableDeferred<Unit>()
            val job = launch {
                controller.events.test {
                    subscribed.complete(Unit)
                    assertEquals(KomotionPlayerEvent.Play, awaitItem())
                    assertEquals(KomotionPlayerEvent.Pause, awaitItem())
                }
            }
            subscribed.await()

            setContent {
                KomotionPlayer(composition = testComposition, controller = controller, autoPlay = false) {
                    LocalFrame.current
                }
            }
            awaitIdle()

            controller.toggle()
            awaitIdle()
            assertTrue(controller.state.value.isPlaying)
            controller.toggle()
            awaitIdle()
            assertFalse(controller.state.value.isPlaying)
            job.cancel()
        }
    }

    @Test
    fun `seeking outside the composition is an error`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        coroutineScope {
            val subscribed = CompletableDeferred<Unit>()
            val job = launch {
                controller.events.test {
                    subscribed.complete(Unit)
                    assertIs<KomotionPlayerEvent.Error>(awaitItem())
                }
            }
            subscribed.await()

            setContent {
                KomotionPlayer(composition = testComposition, controller = controller, autoPlay = false) {
                    LocalFrame.current
                }
            }
            awaitIdle()

            controller.seekTo(999)
            awaitIdle()

            assertIs<String>(controller.state.value.error)
            assertTrue("999" in controller.state.value.error!!)
            job.cancel()
        }
    }

    @Test
    fun `volume and mute commands update the state`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        setContent {
            KomotionPlayer(composition = testComposition, controller = controller, autoPlay = false) {
                LocalFrame.current
            }
        }
        waitForIdle()

        controller.setVolume(0.4f)
        waitForIdle()
        assertEquals(0.4f, controller.state.value.volume)

        controller.setVolume(2f)
        waitForIdle()
        assertEquals(1f, controller.state.value.volume, "volume is clamped to 1.0")

        controller.mute()
        waitForIdle()
        assertTrue(controller.state.value.muted)
        controller.mute()
        waitForIdle()
        assertFalse(controller.state.value.muted)
    }

    @Test
    fun `requestFullscreen updates the state`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        setContent {
            KomotionPlayer(composition = testComposition, controller = controller, autoPlay = false) {
                LocalFrame.current
            }
        }
        waitForIdle()

        assertFalse(controller.state.value.fullscreen)
        controller.requestFullscreen()
        waitForIdle()
        assertTrue(controller.state.value.fullscreen)
    }

    @Test
    fun `playback ends when the window end is reached without looping`() = runComposeUiTest {
        val controller = KomotionPlayerController()
        coroutineScope {
            val subscribed = CompletableDeferred<Unit>()
            val job = launch {
                controller.events.test {
                    subscribed.complete(Unit)
                    var event: KomotionPlayerEvent? = null
                    while (true) {
                        event = awaitItem()
                        if (event is KomotionPlayerEvent.Ended) break
                    }
                    assertEquals(KomotionPlayerEvent.Ended, event)
                }
            }
            subscribed.await()

            // A 3-frame window at 30x speed finishes in a few milliseconds.
            setContent {
                KomotionPlayer(
                    composition = testComposition,
                    controller = controller,
                    inFrame = 57,
                    outFrame = 59,
                    loop = false,
                    autoPlay = true,
                    playbackRate = 30f,
                ) {
                    LocalFrame.current
                }
            }
            awaitIdle()

            // Advance the virtual clock until playback reaches the end of the window.
            withTimeout(10_000) {
                while (controller.state.value.isPlaying) {
                    mainClock.advanceTimeBy(10)
                    awaitIdle()
                }
                job.join()
            }
            assertEquals(59, controller.state.value.frame)
            assertFalse(controller.state.value.isPlaying)
        }
    }
}
