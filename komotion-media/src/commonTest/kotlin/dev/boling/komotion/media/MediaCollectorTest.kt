package dev.boling.komotion.media

import app.cash.molecule.moleculeFlow
import app.cash.molecule.RecompositionMode
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import dev.boling.komotion.core.LocalFrame
import dev.boling.komotion.core.Sequence
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class MediaCollectorTest {

    /**
     * Subscribes to [flow] once, waits for the first emission (initial
     * composition), runs [onChange] (typically advancing the frame), then waits
     * for the second emission (recomposition).
     */
    private suspend fun <T> CoroutineScope.collectTwoEmits(flow: Flow<T>, onChange: () -> Unit) {
        var count = 0
        val done = CompletableDeferred<Unit>()
        val job = launch {
            flow.take(2).collect {
                count++
                if (count == 1) onChange()
                if (count == 2) done.complete(Unit)
            }
        }
        done.await()
        job.join()
    }

    @Test
    fun `declaring audio registers path and timing`() = runBlocking {
        val collector = MediaCollector()
        collector.frame = 40
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 40) {
                    Audio(file = "/a.wav", startFrame = 5)
                }
            }
        }
        flow.first()

        val media = collector.snapshot()
        assertEquals(1, media.size)
        val audio = media[0] as AudioMedia
        assertEquals("/a.wav", audio.file)
        assertEquals(5, audio.startFrame)
        assertEquals(1f, audio.volume)
        assertEquals(1f, audio.playbackRate)
        assertEquals(0, audio.trimStartFrame)
        assertEquals(null, audio.trimEndFrame)
        assertEquals(false, audio.muted)
    }

    @Test
    fun `declaring video and image registers both kinds`() = runBlocking {
        val collector = MediaCollector()
        collector.frame = 10
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 10) {
                    Video(file = "/a.mp4", startFrame = 0)
                    Image(file = "/a.png", startFrame = 2)
                }
            }
        }
        flow.first()

        val media = collector.snapshot()
        assertEquals(2, media.size)
        assertEquals("/a.mp4", (media[0] as VideoMedia).file)
        assertEquals(0, (media[0] as VideoMedia).startFrame)
        assertEquals("/a.png", (media[1] as ImageMedia).file)
        assertEquals(2, (media[1] as ImageMedia).startFrame)
    }

    @Test
    fun `start frame is shifted onto the global timeline inside a sequence`() = runBlocking {
        val collector = MediaCollector()
        collector.frame = 40
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 40) {
                    Sequence(from = 30, durationInFrames = 30) {
                        Audio(file = "/a.wav", startFrame = 5)
                    }
                }
            }
        }
        flow.first()

        val media = collector.snapshot()
        assertEquals(1, media.size)
        assertEquals(35, (media[0] as AudioMedia).startFrame) // 40 - 10 + 5
    }

    @Test
    fun `media does not register outside the sequence window`() = runComposeUiTest {
        val collector = MediaCollector()
        collector.frame = 10
        setContent {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 10) {
                    Sequence(from = 30, durationInFrames = 30) {
                        Audio(file = "/a.wav")
                    }
                }
            }
        }

        assertTrue(collector.snapshot().isEmpty())
    }

    @Test
    fun `volume playbackRate trim and mute affect the collected declaration`() = runBlocking {
        val collector = MediaCollector()
        collector.frame = 0
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 0) {
                    Audio(
                        file = "/a.wav",
                        startFrame = 10,
                        volume = 0.5f,
                        playbackRate = 2f,
                        trimStartFrame = 3,
                        trimEndFrame = 12,
                        muted = true,
                    )
                }
            }
        }
        flow.first()

        val audio = collector.snapshot()[0] as AudioMedia
        assertEquals(0.5f, audio.volume)
        assertEquals(2f, audio.playbackRate)
        assertEquals(3, audio.trimStartFrame)
        assertEquals(12, audio.trimEndFrame)
        assertEquals(true, audio.muted)
    }

    @Test
    fun `repeated composition of the same call site registers once`() = runBlocking {
        val collector = MediaCollector()
        var frame by mutableStateOf(40)
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            collector.frame = frame
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides frame) {
                    Audio(file = "/a.wav", startFrame = 5)
                }
            }
            frame
        }
        collectTwoEmits(flow) { frame = 45 }

        val media = collector.snapshot()
        assertEquals(1, media.size)
        assertEquals(5, (media[0] as AudioMedia).startFrame)
    }

    @Test
    fun `declarations from different windows accumulate across frames`() = runComposeUiTest {
        val collector = MediaCollector()
        var frame by mutableStateOf(10)
        collector.frame = 10
        setContent {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides frame) {
                    Sequence(from = 0, durationInFrames = 30) {
                        Audio(file = "/a.wav", startFrame = 5)
                    }
                    Sequence(from = 30, durationInFrames = 30) {
                        Audio(file = "/b.wav", startFrame = 5)
                    }
                }
            }
        }

        // Initial composition at frame 10: only window A is active.
        assertEquals(1, collector.snapshot().size)

        frame = 40
        collector.frame = 40
        waitUntil("100.ms", 5000) { collector.snapshot().size == 2 }

        val media = collector.snapshot()
        assertEquals("/a.wav", (media[0] as AudioMedia).file)
        assertEquals(5, (media[0] as AudioMedia).startFrame)
        assertEquals("/b.wav", (media[1] as AudioMedia).file)
        assertEquals(35, (media[1] as AudioMedia).startFrame) // 40 - 10 + 5
    }

    @Test
    fun `clear removes all declarations`() = runBlocking {
        val collector = MediaCollector()
        collector.frame = 0
        val flow = moleculeFlow(RecompositionMode.Immediate) {
            CompositionLocalProvider(LocalMediaCollector provides collector) {
                CompositionLocalProvider(LocalFrame provides 0) {
                    Audio(file = "/a.wav")
                }
            }
        }
        flow.first()

        collector.clear()
        assertTrue(collector.snapshot().isEmpty())
    }
}
