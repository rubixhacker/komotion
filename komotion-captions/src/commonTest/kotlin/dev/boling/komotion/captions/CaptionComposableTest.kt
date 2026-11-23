package dev.boling.komotion.captions

import app.cash.molecule.RecompositionMode
import app.cash.molecule.moleculeFlow
import app.cash.turbine.test
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import dev.boling.komotion.core.LocalFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

class CaptionComposableTest {

    private val captions = listOf(
        Caption("First", 0, 30),
        Caption("Second", 30, 60),
    )

    @Test
    fun `renders the active cue for the current LocalFrame`() = runTest {
        var observed: String? = null
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 45) {
                Caption(captions) { cue -> observed = cue.text }
            }
            observed
        }
        flow.test {
            assertEquals("Second", awaitItem())
        }
    }

    @Test
    fun `renders the first cue at its start frame`() = runTest {
        var observed: String? = null
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 0) {
                Caption(captions) { cue -> observed = cue.text }
            }
            observed
        }
        flow.test {
            assertEquals("First", awaitItem())
        }
    }

    @Test
    fun `switches to the next cue when its start frame is reached`() = runTest {
        var observed: String? = null
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 30) {
                Caption(captions) { cue -> observed = cue.text }
            }
            observed
        }
        flow.test {
            assertEquals("Second", awaitItem())
        }
    }

    @Test
    fun `renders nothing when no cue covers the frame`() = runTest {
        var observed: String? = null
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 60) {
                Caption(captions) { cue -> observed = cue.text }
            }
            observed
        }
        flow.test {
            assertNull(awaitItem())
        }
    }

    @Test
    fun `renders nothing before the first cue`() = runTest {
        val later = listOf(Caption("Later", 10, 20))
        var observed: String? = null
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 5) {
                Caption(later) { cue -> observed = cue.text }
            }
            observed
        }
        flow.test {
            assertNull(awaitItem())
        }
    }

    @Test
    @OptIn(ExperimentalTestApi::class)
    fun `default content renders the active cue text`() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalFrame provides 45) {
                Caption(captions)
            }
        }
        onNodeWithText("Second").assertIsDisplayed()
        onNodeWithText("First").assertDoesNotExist()
    }
}
