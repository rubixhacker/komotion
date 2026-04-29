package dev.boling.komotion.export

import dev.boling.komotion.core.TextFitReport
import dev.boling.komotion.core.checkTextFits
import org.jetbrains.skia.Font
import org.jetbrains.skia.FontMgr
import org.jetbrains.skia.FontStyle
import org.jetbrains.skia.Typeface

/**
 * Skia-backed text width measurement for desktop builds.
 *
 * The render pipeline uses Skiko (the Skia binding behind Compose Desktop) to
 * paint frames; using Skia here means the measurements match what the renderer
 * will actually draw at export time.
 */
object SkiaTextMeasurer {

    private val fontMgr: FontMgr by lazy { FontMgr.default }

    /**
     * Build a measurement callback for [checkTextFits].
     *
     * @param fontSizePx font size in pixels (skia uses pixel sizes directly)
     * @param fontFamily optional family name; null falls back to the system default
     * @param style font style (regular, bold, italic, ...)
     */
    fun measurer(
        fontSizePx: Float,
        fontFamily: String? = null,
        style: FontStyle = FontStyle.NORMAL,
    ): (String) -> Float {
        val typeface: Typeface? = fontFamily?.let { fontMgr.matchFamilyStyle(it, style) }
        // Font accepts a null typeface and falls back to a platform default.
        val font = Font(typeface, fontSizePx)
        return { token -> font.measureTextWidth(token) }
    }

    /**
     * Convenience: run [checkTextFits] using a Skia-backed measurer.
     */
    fun check(
        text: String,
        maxWidthPx: Float,
        fontSizePx: Float,
        fontFamily: String? = null,
        style: FontStyle = FontStyle.NORMAL,
    ): TextFitReport = checkTextFits(text, maxWidthPx, measurer(fontSizePx, fontFamily, style))
}
