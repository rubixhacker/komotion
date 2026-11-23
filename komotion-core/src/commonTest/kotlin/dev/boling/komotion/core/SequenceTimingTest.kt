package dev.boling.komotion.core

import app.cash.molecule.RecompositionMode
import app.cash.molecule.moleculeFlow
import app.cash.turbine.test
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Per-frame behavior of [Sequence]'s timing model, driven one frame at a time
 * through a Molecule flow and collected with Turbine.
 *
 * Molecule cannot compose UI that produces layout nodes, so the Molecule-driven
 * tests cover the in-window frames; out-of-window and layout behavior is covered
 * with [runComposeUiTest].
 */
@OptIn(ExperimentalTestApi::class)
class SequenceTimingTest {

    /**
     * Drives [frames] through [content] one frame at a time and returns the value
     * [content] reports for each parent frame. [content] receives the parent frame.
     */
    private suspend fun <T> framesFor(
        frames: List<Int>,
        content: @Composable (Int) -> T,
    ): List<T> {
        val frame = mutableStateOf(frames.first())
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            content(frame.value)
        }
        val values = mutableListOf<T>()
        flow.test {
            for (f in frames) {
                frame.value = f
                values.add(awaitItem())
            }
            cancel()
        }
        return values
    }

    @Test
    fun `in-window child receives local frame offset from global frame`() = runBlocking {
        val values = framesFor((30..89).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 30, durationInFrames = 60) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        assertEquals((0..59).toList(), values)
    }

    @Test
    fun `null duration runs until the parent ends`() = runBlocking {
        val values = framesFor((30..120).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 30) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        assertEquals((0..90).toList(), values)
    }

    @Test
    fun `trimBefore advances the child frame without moving the start`() = runBlocking {
        val values = framesFor((30..44).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 30, durationInFrames = 60, trimBefore = 10) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        // The start is still 30: mounted at frame 30 with child frame -10; child frame 0 at frame 40.
        assertEquals((-10..4).toList(), values)
    }

    @Test
    fun `playbackRate 2 scales child frames and shortens the mounted window`() = runBlocking {
        val values = framesFor((0..29).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 60, playbackRate = 2.0) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        // Mounted window is 60/2 = 30 parent frames; the child advances 2 frames per parent frame.
        assertEquals((0 until 30).map { it * 2 }, values)
    }

    @Test
    fun `playbackRate 0_5 scales child frames and lengthens the mounted window`() = runBlocking {
        val values = framesFor((116..119).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 60, playbackRate = 0.5) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        // Mounted window is 60/0.5 = 120 parent frames; the child holds each frame for 2 parent frames.
        assertEquals(listOf(58, 58, 59, 59), values)
    }

    @Test
    fun `nested playback rates multiply`() = runBlocking {
        val values = framesFor((0..6).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 100, playbackRate = 2.0) {
                    Sequence(from = 0, durationInFrames = 100, playbackRate = 3.0) {
                        observed = LocalFrame.current
                    }
                }
            }
            observed
        }
        assertEquals((0..6).map { it * 6 }, values)
    }

    @Test
    fun `non-positive playbackRate throws IllegalArgumentException`() = runComposeUiTest {
        listOf(0.0, -1.0).forEach { rate ->
            val error = assertFailsWith<IllegalArgumentException> {
                setContent {
                    CompositionLocalProvider(LocalFrame provides 0) {
                        Sequence(from = 0, durationInFrames = 60, playbackRate = rate) { }
                    }
                }
            }
            assertTrue(error.message.orEmpty().contains("playbackRate"))
        }
    }

    @Test
    fun `freeze pins the child to one frame while mounted`() = runBlocking {
        val values = framesFor((30..89).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 30, durationInFrames = 60, freeze = 15) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        assertEquals(List(60) { 15 }, values)
    }

    @Test
    fun `loop repeats the trimmed range while the required duration is finite`() = runBlocking {
        val values = framesFor((0..65).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 30, loop = true) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        // The sequence stays mounted until the parent ends; the child cycles 0..29 repeatedly.
        assertEquals((0..65).map { it % 30 }, values)
    }

    @Test
    fun `loop cycles the trimmed range from the trim offset`() = runBlocking {
        val values = framesFor((0..40).toList()) { globalFrame ->
            var observed = Int.MIN_VALUE
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 30, trimBefore = 10, loop = true) {
                    observed = LocalFrame.current
                }
            }
            observed
        }
        assertEquals((0..40).map { ((it - 10) % 30 + 30) % 30 }, values)
    }

    @Test
    fun `loop without a finite duration throws IllegalArgumentException`() = runComposeUiTest {
        val error = assertFailsWith<IllegalArgumentException> {
            setContent {
                CompositionLocalProvider(LocalFrame provides 0) {
                    Sequence(from = 0, loop = true) { }
                }
            }
        }
        assertTrue(error.message.orEmpty().contains("durationInFrames"))
    }

    @Test
    fun `name is carried via LocalSequenceName`() = runBlocking {
        val values = framesFor((0..2).toList()) { globalFrame ->
            var observed: String? = null
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 60, name = "intro") {
                    observed = LocalSequenceName.current
                }
            }
            observed
        }
        assertEquals(listOf("intro", "intro", "intro"), values)
    }

    @Test
    fun `innermost sequence name wins`() = runBlocking {
        val values = framesFor(listOf(0)) { globalFrame ->
            var observed: String? = null
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 100, name = "outer") {
                    Sequence(from = 0, durationInFrames = 60, name = "inner") {
                        observed = LocalSequenceName.current
                    }
                }
            }
            observed
        }
        assertEquals(listOf("inner"), values)
    }

    @Test
    fun `name defaults to null when not provided`() = runBlocking {
        val values = framesFor(listOf(0)) { globalFrame ->
            var observed: String? = null
            CompositionLocalProvider(LocalFrame provides globalFrame) {
                Sequence(from = 0, durationInFrames = 60) {
                    observed = LocalSequenceName.current
                }
            }
            observed
        }
        assertEquals(listOf(null), values)
    }

    @Test
    fun `before start does not compose content`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            CompositionLocalProvider(LocalFrame provides 29) {
                Sequence(from = 30) {
                    contentCalled = true
                }
            }
        }
        assertFalse(contentCalled)
        setContent {
            CompositionLocalProvider(LocalFrame provides 30) {
                Sequence(from = 30) {
                    contentCalled = true
                }
            }
        }
        assertTrue(contentCalled)
    }

    @Test
    fun `finite duration ends the window`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            CompositionLocalProvider(LocalFrame provides 89) {
                Sequence(from = 30, durationInFrames = 60) {
                    contentCalled = true
                }
            }
        }
        assertTrue(contentCalled)
        contentCalled = false
        setContent {
            CompositionLocalProvider(LocalFrame provides 90) {
                Sequence(from = 30, durationInFrames = 60) {
                    contentCalled = true
                }
            }
        }
        assertFalse(contentCalled)
    }

    @Test
    fun `AbsoluteFill fills the parent`() = runComposeUiTest {
        setContent {
            Box(Modifier.size(200.dp)) {
                Box(Modifier.size(100.dp)) {
                    AbsoluteFill(Modifier.testTag("overlay")) {
                        Box(Modifier.fillMaxSize().background(Color.Red))
                    }
                }
            }
        }
        onNodeWithTag("overlay")
            .assertWidthIsEqualTo(100.dp)
            .assertHeightIsEqualTo(100.dp)
    }

    @Test
    fun `sequence adds no layout wrapper by default`() = runComposeUiTest {
        setContent {
            Box(Modifier.size(100.dp)) {
                Sequence(from = 0, durationInFrames = 60) {
                    Box(Modifier.fillMaxSize().testTag("child").background(Color.Red))
                }
            }
        }
        // The child fills the outer Box directly — no wrapper in between.
        onNodeWithTag("child")
            .assertWidthIsEqualTo(100.dp)
            .assertHeightIsEqualTo(100.dp)
    }
}
