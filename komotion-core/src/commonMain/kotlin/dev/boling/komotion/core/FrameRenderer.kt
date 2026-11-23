package dev.boling.komotion.core

import androidx.compose.runtime.Composable

/**
 * Renders a [Composition] to an output file frame-by-frame.
 *
 * Must be called on the Main dispatcher. Implementations handle internal
 * dispatcher switching for CPU-intensive or I/O work.
 *
 * [outputPath] must be an absolute path string (using String avoids java.nio.Path
 * which is not available in commonMain).
 *
 * [onProgress] is called for every frame completed, in the [RenderStage.Rendering]
 * and [RenderStage.Encoding] stages.
 */
interface FrameRenderer {
    suspend fun render(
        composition: Composition,
        outputPath: String,
        content: @Composable () -> Unit,
        audioTracks: List<AudioTrack> = emptyList(),
        onProgress: (RenderProgress) -> Unit = {},
        options: ExportOptions = ExportOptions(),
    )
}
