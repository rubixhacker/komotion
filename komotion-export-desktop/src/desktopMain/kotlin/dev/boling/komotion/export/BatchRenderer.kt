package dev.boling.komotion.export

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.FrameRenderer
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

/**
 * One job for the batch renderer. The composable is captured by reference, so
 * each render call invokes it with its own LocalFrame/LocalComposition.
 */
data class RenderRequest(
    val composition: Composition,
    val outputPath: String,
    val audioTracks: List<AudioTrack> = emptyList(),
    val content: @Composable () -> Unit,
)

/**
 * Result from one job in a batch. Failures don't abort the batch — the caller
 * decides what to do with the [error] field.
 */
data class BatchResult(
    val request: RenderRequest,
    val error: Throwable? = null,
) {
    val ok: Boolean get() = error == null
}

/**
 * Renders multiple compositions concurrently. Previously each video was
 * exported sequentially in a `for` loop, which left most cores idle while
 * FFmpeg encoded one stream at a time; running [parallelism] jobs at once cuts
 * end-to-end batch time roughly proportional to that factor.
 *
 * Each job uses its own [FfmpegFrameRenderer] instance, so per-renderer state
 * (the OffscreenRenderer scene, FFmpeg process) is fully isolated. The
 * [parallelism] cap is a semaphore — extra jobs queue and start as permits
 * free up.
 *
 * Default parallelism is conservative (`processors / 2`) because each job
 * forks an FFmpeg encoder that is itself multi-threaded; oversubscribing is a
 * net loss.
 */
class BatchRenderer(
    val parallelism: Int = defaultParallelism(),
    val rendererFactory: () -> FrameRenderer = { FfmpegFrameRenderer() },
    val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) {

    init {
        require(parallelism > 0) { "parallelism must be > 0, was $parallelism" }
    }

    /**
     * Render every request concurrently, capped at [parallelism]. Returns a
     * result per request in the same order as [requests]. Any per-request
     * failure is captured in [BatchResult.error] and does not abort the batch.
     */
    suspend fun renderAll(
        requests: List<RenderRequest>,
        onProgress: (request: RenderRequest, framesRendered: Int) -> Unit = { _, _ -> },
    ): List<BatchResult> = coroutineScope {
        val gate = Semaphore(parallelism)
        requests.map { req ->
            async(dispatcher) {
                gate.withPermit {
                    runCatching {
                        // Each job gets its own renderer — Compose's
                        // ImageComposeScene is not safe to share across
                        // concurrent renders.
                        val renderer = rendererFactory()
                        // The renderer itself jumps to Dispatchers.Main as
                        // needed; here we just make sure progress callbacks
                        // bubble up with the request attached.
                        withContext(dispatcher) {
                            renderer.render(
                                composition = req.composition,
                                outputPath = req.outputPath,
                                content = req.content,
                                audioTracks = req.audioTracks,
                                onProgress = { f -> onProgress(req, f) },
                            )
                        }
                    }.fold(
                        onSuccess = { BatchResult(req) },
                        onFailure = { BatchResult(req, it) },
                    )
                }
            }
        }.awaitAll()
    }
}

private fun defaultParallelism(): Int =
    (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
