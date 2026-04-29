package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.Composition
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BatchRendererTest {

    @Test
    fun `rejects parallelism less than 1`() {
        kotlin.runCatching { BatchRenderer(parallelism = 0) }
            .let { assertTrue(it.isFailure) }
    }

    @Test
    fun `caps concurrency at parallelism`() = runBlocking {
        val maxObserved = ConcurrencyTracker()
        val batch = BatchRenderer(
            parallelism = 2,
            rendererFactory = { FakeRenderer(maxObserved, durationMs = 60) },
        )
        val requests = (0 until 6).map { i ->
            RenderRequest(
                composition = Composition(2, 2, 1, 1),
                outputPath = "/tmp/x$i.mp4",
                content = @Composable {},
            )
        }
        val results = batch.renderAll(requests)
        assertEquals(6, results.size)
        assertTrue(results.all { it.ok })
        assertTrue(maxObserved.peak <= 2, "peak concurrency was ${maxObserved.peak}, expected <= 2")
    }

    @Test
    fun `failure in one job does not abort the batch`() = runBlocking {
        val maxObserved = ConcurrencyTracker()
        val batch = BatchRenderer(
            parallelism = 2,
            rendererFactory = {
                FakeRenderer(maxObserved, durationMs = 5, throwOnPath = "/tmp/bad.mp4")
            },
        )
        val requests = listOf(
            RenderRequest(Composition(2, 2, 1, 1), "/tmp/ok1.mp4", content = @Composable {}),
            RenderRequest(Composition(2, 2, 1, 1), "/tmp/bad.mp4", content = @Composable {}),
            RenderRequest(Composition(2, 2, 1, 1), "/tmp/ok2.mp4", content = @Composable {}),
        )
        val results = batch.renderAll(requests)
        assertEquals(3, results.size)
        val byPath = results.associateBy { it.request.outputPath }
        assertTrue(byPath.getValue("/tmp/ok1.mp4").ok)
        assertFalse(byPath.getValue("/tmp/bad.mp4").ok)
        assertTrue(byPath.getValue("/tmp/ok2.mp4").ok)
    }
}

private class ConcurrencyTracker {
    private val mu = Mutex()
    var inFlight: Int = 0
        private set
    var peak: Int = 0
        private set

    suspend fun enter() {
        mu.withLock {
            inFlight += 1
            if (inFlight > peak) peak = inFlight
        }
    }

    suspend fun leave() {
        mu.withLock { inFlight -= 1 }
    }
}

/**
 * Test double — a FrameRenderer that delays a configurable amount and
 * optionally throws for a specific path.
 */
private class FakeRenderer(
    private val tracker: ConcurrencyTracker,
    private val durationMs: Long,
    private val throwOnPath: String? = null,
) : dev.boling.komotion.core.FrameRenderer {

    override suspend fun render(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<dev.boling.komotion.core.AudioTrack>,
        onProgress: (framesRendered: Int) -> Unit,
    ) {
        tracker.enter()
        try {
            if (outputPath == throwOnPath) error("synthetic failure")
            delay(durationMs)
            onProgress(composition.durationInFrames)
        } finally {
            tracker.leave()
        }
    }
}
