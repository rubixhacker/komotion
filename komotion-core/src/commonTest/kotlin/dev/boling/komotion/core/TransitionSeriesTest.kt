package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

@OptIn(ExperimentalTestApi::class, ExperimentalKomotionApi::class)
class TransitionSeriesTest {

    @Test
    fun `total duration is sum of scene durations minus overlaps`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        assertEquals(60, scope.totalDurationInFrames)
    }

    @Test
    fun `scene before the overlap receives local frame offset from its start`() = runComposeUiTest {
        var scene1Frame = -1
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides 35) {
                    TransitionSeries {
                        Scene(40) { scene1Frame = LocalFrame.current }
                        Fade(durationInFrames = 10)
                        Scene(30) { }
                    }
                }
            }
        }
        assertEquals(35, scene1Frame)
    }

    @Test
    fun `overlap frame composes both scenes with their local frames`() = runComposeUiTest {
        var scene1Frame = -1
        var scene2Frame = -1
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides 35) {
                    TransitionSeries {
                        Scene(40) { scene1Frame = LocalFrame.current }
                        Fade(durationInFrames = 10)
                        Scene(30) { scene2Frame = LocalFrame.current }
                    }
                }
            }
        }
        // Transition zone is frames 30..39: scene 1 sees 35, scene 2 sees 5.
        assertEquals(35, scene1Frame)
        assertEquals(5, scene2Frame)
    }

    @Test
    fun `after the overlap only the incoming scene is composed`() = runComposeUiTest {
        var scene1Called = false
        var scene2Frame = -1
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides 45) {
                    TransitionSeries {
                        Scene(40) { scene1Called = true }
                        Fade(durationInFrames = 10)
                        Scene(30) { scene2Frame = LocalFrame.current }
                    }
                }
            }
        }
        assertFalse(scene1Called)
        assertEquals(15, scene2Frame)
    }

    @Test
    fun `before the timeline start renders nothing`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides -1) {
                    TransitionSeries {
                        Scene(40) { contentCalled = true }
                        Fade(durationInFrames = 10)
                        Scene(30) { contentCalled = true }
                    }
                }
            }
        }
        assertFalse(contentCalled)
    }

    @Test
    fun `after the timeline end renders nothing`() = runComposeUiTest {
        var contentCalled = false
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides 60) {
                    TransitionSeries {
                        Scene(40) { contentCalled = true }
                        Fade(durationInFrames = 10)
                        Scene(30) { contentCalled = true }
                    }
                }
            }
        }
        assertFalse(contentCalled)
    }

    @Test
    fun `each transition type composes both scenes during the overlap`() = runComposeUiTest {
        val addTransition: List<(TransitionScope) -> Unit> = listOf(
            { it.Fade(durationInFrames = 10) },
            { it.Slide(durationInFrames = 10) },
            { it.Wipe(durationInFrames = 10) },
            { it.Iris(durationInFrames = 10) },
            { it.ClockWipe(durationInFrames = 10) },
        )
        addTransition.forEach { add ->
            var scene1Frame = -1
            var scene2Frame = -1
            setContent {
                fixedSizeBox(100, 100) {
                    CompositionLocalProvider(LocalFrame provides 35) {
                        TransitionSeries {
                            Scene(40) { scene1Frame = LocalFrame.current }
                            add(this)
                            Scene(30) { scene2Frame = LocalFrame.current }
                        }
                    }
                }
            }
            assertEquals(35, scene1Frame)
            assertEquals(5, scene2Frame)
        }
    }

    @Test
    fun `scope overload renders the same timeline`() = runComposeUiTest {
        var scene2Frame = -1
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { scene2Frame = LocalFrame.current }
        assertEquals(60, scope.totalDurationInFrames)
        setContent {
            fixedSizeBox(100, 100) {
                CompositionLocalProvider(LocalFrame provides 45) {
                    TransitionSeries(scope)
                }
            }
        }
        assertEquals(15, scene2Frame)
    }
}

/** A fixed-size container, so test content receives bounded constraints. */
@Composable
private fun fixedSizeBox(width: Int, height: Int, content: @Composable () -> Unit) {
    Layout(content = content) { measurables, constraints ->
        val placeables = measurables.map { it.measure(constraints) }
        layout(width, height) {
            placeables.forEach { it.place(0, 0) }
        }
    }
}
