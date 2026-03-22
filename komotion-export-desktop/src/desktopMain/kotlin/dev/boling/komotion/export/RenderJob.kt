package dev.boling.komotion.export

import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow

/**
 * Tracks an in-progress render launched by [FfmpegFrameRenderer.renderAsync].
 *
 * Observe [progress] and [isComplete] as StateFlows.
 * Call [cancel] to abort — the temp directory is always cleaned up.
 */
class RenderJob internal constructor(
    /** Number of frames written so far. */
    val progress: StateFlow<Int>,
    /** Total frames in the composition. */
    val totalFrames: Int,
    /** True once all frames are rendered and FFmpeg has exited successfully. */
    val isComplete: StateFlow<Boolean>,
    /** Non-null if the render failed or was cancelled. */
    val error: StateFlow<Throwable?>,
    private val job: Job,
) {
    /**
     * Cancels the render. The render coroutine's finally block deletes the
     * temp PNG directory — no partial frames are left on disk.
     */
    fun cancel() = job.cancel()
}
