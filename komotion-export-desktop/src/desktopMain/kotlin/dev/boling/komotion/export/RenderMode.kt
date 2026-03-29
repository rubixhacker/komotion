package dev.boling.komotion.export

/**
 * Controls how frames are delivered to FFmpeg during export.
 */
enum class RenderMode {
    /** Pipe raw BGRA pixels to FFmpeg stdin — fast, no intermediate files. */
    Pipe,
    /** Write PNG frames to a temp directory, then encode — useful for debugging. */
    PngSequence,
}
