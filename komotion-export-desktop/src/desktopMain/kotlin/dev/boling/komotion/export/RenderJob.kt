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
     * Cancels the render. Worker coroutines and the FFmpeg process are
     * torn down cleanly. In PngSequence mode, the temp directory is deleted.
     */
    fun cancel() = job.cancel()
}
