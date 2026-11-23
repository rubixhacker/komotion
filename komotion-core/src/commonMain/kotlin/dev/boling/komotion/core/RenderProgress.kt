package dev.boling.komotion.core

/**
 * A stage of the export pipeline.
 */
enum class RenderStage {
    /** Frames are being rendered to pixels. */
    Rendering,
    /** Frames are being encoded to the output file. */
    Encoding,
}

/**
 * Progress of an export in progress.
 *
 * @property stage The stage this event belongs to.
 * @property framesCompleted Frames completed in [stage] so far.
 * @property totalFrames Total frames in the export.
 */
data class RenderProgress(
    val stage: RenderStage,
    val framesCompleted: Int,
    val totalFrames: Int,
)
