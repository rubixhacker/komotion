package dev.boling.komotion.core

/**
 * Result of a text-fit check. [overflowingWords] is empty when every token
 * fits inside [maxWidthPx] at the given font size. [widestWordPx] is the
 * measured width of the longest token (useful for diagnostics).
 */
data class TextFitReport(
    val overflowingWords: List<String>,
    val widestWordPx: Float,
    val maxWidthPx: Float,
) {
    val ok: Boolean get() = overflowingWords.isEmpty()
}

/**
 * Measures individual whitespace-separated tokens of [text] against [maxWidthPx]
 * using [measure] to convert a string into pixel width at the rendering font.
 *
 * No single word should ever be wider than the layout box — Compose will silently
 * clip or push it past the right edge rather than introduce a hyphen, and the
 * artifact is hard to spot until you see it on a 1080p frame. Run this guard at
 * build time on any user-controlled string that's about to be rendered into a
 * fixed-width slot; treat a non-empty [TextFitReport.overflowingWords] as a
 * blocking warning and either shrink the font, widen the slot, or rewrite the
 * copy.
 *
 * The function is platform-agnostic: pass any [measure] callback (Skia Font on
 * desktop, Paragraph on Android, a stub in tests). See `TextMeasurers` in
 * `komotion-export-desktop` for the Skia-backed implementation used during
 * MP4 export.
 */
fun checkTextFits(
    text: String,
    maxWidthPx: Float,
    measure: (String) -> Float,
): TextFitReport {
    require(maxWidthPx > 0f) { "maxWidthPx must be positive, was $maxWidthPx" }
    val tokens = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
    var widest = 0f
    val overflowing = mutableListOf<String>()
    for (token in tokens) {
        val w = measure(token)
        if (w > widest) widest = w
        if (w > maxWidthPx) overflowing += token
    }
    return TextFitReport(
        overflowingWords = overflowing.distinct(),
        widestWordPx = widest,
        maxWidthPx = maxWidthPx,
    )
}
