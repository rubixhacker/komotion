package dev.boling.komotion.export

import dev.boling.komotion.core.Composition

/**
 * Configures the cheap-and-fast iteration render. Call [apply] on a Composition
 * to get back a downscaled version that lays out identically (same aspect
 * ratio, same per-frame layout) but renders in seconds instead of minutes.
 *
 * Defaults target ~240p / 5fps — small enough to spot-check layout, alignment,
 * text wrap, and segment timing, without committing to the full encode.
 */
data class PreviewProfile(
    val targetHeight: Int = 240,
    val fps: Int = 5,
) {
    init {
        require(targetHeight > 0) { "targetHeight must be > 0, was $targetHeight" }
        require(fps > 0) { "fps must be > 0, was $fps" }
    }

    /**
     * Returns a downscaled [Composition]. Width is scaled to keep the original
     * aspect ratio. Duration in *seconds* is preserved — the new frame count is
     * recomputed from the new fps so animations play at the same wall-clock
     * speed.
     */
    fun apply(composition: Composition): Composition {
        val scale = targetHeight.toDouble() / composition.height
        val newWidth = (composition.width * scale).toInt().coerceAtLeast(2).let {
            // Keep width even — yuv420p requires both dimensions to be even.
            if (it % 2 == 0) it else it - 1
        }
        val newHeight = if (targetHeight % 2 == 0) targetHeight else targetHeight - 1
        val durationSeconds = composition.durationInFrames.toDouble() / composition.fps
        val newDuration = (durationSeconds * fps).toInt().coerceAtLeast(1)
        return composition.copy(
            width = newWidth,
            height = newHeight,
            durationInFrames = newDuration,
            fps = fps,
        )
    }

    companion object {
        /** Default fast-preview profile: 240p, 5fps. */
        val Default = PreviewProfile()
    }
}
