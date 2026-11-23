package dev.boling.komotion.core

import app.cash.molecule.RecompositionMode
import app.cash.molecule.moleculeFlow
import app.cash.turbine.test
import androidx.compose.runtime.CompositionLocalProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalKomotionApi::class)
class SeriesTest {

    // Pure frame arithmetic

    @Test
    fun `planSceneWindows resolves scenes back to back`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(20, 0)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(40, 60)), windows)
    }

    @Test
    fun `planSceneWindows gives a positive offset a gap after the previous scene`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(20, 10)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(50, 70)), windows)
    }

    @Test
    fun `planSceneWindows gives a negative offset an overlap with the previous scene`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(20, -10)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(30, 50)), windows)
    }

    @Test
    fun `planSceneWindows shifts every following scene by an offset`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(20, 10), ScenePlan(30, 0)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(50, 70), SceneWindow(70, 100)), windows)
    }

    @Test
    fun `planSceneWindows shifts following scenes earlier with a negative offset`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(20, -10), ScenePlan(30, 0)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(30, 50), SceneWindow(50, 80)), windows)
    }

    @Test
    fun `planSceneWindows makes a negative duration run until the end`() {
        val windows = planSceneWindows(listOf(ScenePlan(40, 0), ScenePlan(-1, 0)))
        assertEquals(listOf(SceneWindow(0, 40), SceneWindow(40, Int.MAX_VALUE)), windows)
    }

    @Test
    fun `requireValidScenePlans rejects a non-last scene with negative duration`() {
        val error = assertFailsWith<IllegalArgumentException> {
            requireValidScenePlans(listOf(ScenePlan(-1, 0), ScenePlan(20, 0)))
        }
        assertTrue(error.message.orEmpty().contains("positive duration"))
    }

    @Test
    fun `requireValidScenePlans rejects zero duration`() {
        assertFailsWith<IllegalArgumentException> { requireValidScenePlans(listOf(ScenePlan(0, 0))) }
        assertFailsWith<IllegalArgumentException> {
            requireValidScenePlans(listOf(ScenePlan(20, 0), ScenePlan(0, 0)))
        }
    }

    @Test
    fun `requireValidScenePlans rejects an empty series`() {
        assertFailsWith<IllegalArgumentException> { requireValidScenePlans(emptyList()) }
    }

    // Composable behavior (Molecule)

    @Test
    fun `scenes play back to back and each clock starts at 0`() = runTest {
        var firstAtZero = -1
        var secondAtBoundary = -1
        val flowAtZero = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 0) {
                Series {
                    Sequence(durationInFrames = 40) { firstAtZero = currentFrame() }
                    Sequence(durationInFrames = 20) { }
                }
            }
            firstAtZero
        }
        val flowAtBoundary = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 40) {
                Series {
                    Sequence(durationInFrames = 40) { }
                    Sequence(durationInFrames = 20) { secondAtBoundary = currentFrame() }
                }
            }
            secondAtBoundary
        }
        flowAtZero.test {
            assertEquals(0, awaitItem())
        }
        flowAtBoundary.test {
            assertEquals(0, awaitItem())
        }
    }

    @Test
    fun `positive offset leaves a gap with no active scene`() = runTest {
        var contentCalled = false
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 45) {
                Series {
                    Sequence(durationInFrames = 40) { contentCalled = true }
                    Sequence(durationInFrames = 20, offset = 10) { contentCalled = true }
                }
            }
            contentCalled
        }
        // Windows: [0, 40) and [50, 70) — global 45 is in the gap.
        flow.test {
            assertEquals(false, awaitItem())
        }
    }

    @Test
    fun `negative offset overlaps the previous scene`() = runTest {
        val observed = mutableListOf<Int>()
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 35) {
                Series {
                    Sequence(durationInFrames = 40) { observed += currentFrame() }
                    Sequence(durationInFrames = 20, offset = -10) { observed += currentFrame() }
                }
            }
            observed.toList()
        }
        // Windows: [0, 40) and [30, 50) — both scenes are active at global 35.
        flow.test {
            assertEquals(listOf(35, 5), awaitItem())
        }
    }

    @Test
    fun `offset shifts every following scene`() = runTest {
        val observed = mutableListOf<Int>()
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 75) {
                Series {
                    Sequence(durationInFrames = 40) { observed += currentFrame() }
                    Sequence(durationInFrames = 20, offset = 10) { observed += currentFrame() }
                    Sequence(durationInFrames = 30) { observed += currentFrame() }
                }
            }
            observed.toList()
        }
        // Windows: [0, 40), [50, 70), [70, 100) — only the third scene is active at global 75.
        flow.test {
            assertEquals(listOf(5), awaitItem())
        }
    }

    @Test
    fun `last scene may be infinite`() = runTest {
        val observed = mutableListOf<Int>()
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 999) {
                Series {
                    Sequence(durationInFrames = 40) { observed += currentFrame() }
                    Sequence(durationInFrames = -1) { observed += currentFrame() }
                }
            }
            observed.toList()
        }
        // Windows: [0, 40) and [40, Int.MAX_VALUE) — the infinite scene is active at global 999.
        flow.test {
            assertEquals(listOf(959), awaitItem())
        }
    }

    @Test
    fun `out-of-window scene does not call content`() = runTest {
        var contentCalled = false
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalFrame provides 10) {
                Series {
                    Sequence(durationInFrames = 40, offset = 20) { contentCalled = true }
                }
            }
            contentCalled
        }
        // Window: [20, 60) — global 10 is before the scene starts.
        flow.test {
            assertEquals(false, awaitItem())
        }
    }
}
