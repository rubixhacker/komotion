package dev.boling.komotion.core

import androidx.compose.ui.text.font.FontFamily

/**
 * A reference to a font file (TTF or OTF) loaded from the platform's storage.
 *
 * The same reference loads on every target:
 * - On Android, iOS and Desktop, [path] is a path on the local file system.
 * - On wasmJs, [path] is a URL served alongside the app.
 *
 * The font data is loaded when the [FontAsset] is constructed. A missing or
 * unreadable file, or data that is not a font, throws [IllegalArgumentException]
 * rather than silently falling back to a system font.
 */
@ExperimentalKomotionApi
expect class FontAsset(path: String) {

    /** The path or URL the font was loaded from. */
    val path: String

    /** The raw font file data. */
    val data: ByteArray

    /** A [FontFamily] built from this asset's data. */
    fun toFontFamily(): FontFamily
}

/**
 * Validates that [data] looks like a font file: non-trivial size and a
 * TTF/OTF/WOFF header. Throws [IllegalArgumentException] otherwise, so a
 * missing or unreadable font surfaces an error instead of silently falling
 * back to a system font.
 */
internal fun requireFontData(path: String, data: ByteArray) {
    require(data.size >= MIN_FONT_DATA_SIZE) {
        "Font file is too small to be a font: $path"
    }
    require(hasFontHeader(data)) {
        "Not a valid font file (missing TTF/OTF/WOFF header): $path"
    }
}

/** The smallest size a TTF/OTF/WOFF file can be. */
private const val MIN_FONT_DATA_SIZE = 12

/** SFNT (TTF/OTF) version 1.0 header. */
private val SFNT_HEADER = byteArrayOf(0, 1, 0, 0)

/** WOFF header; WOFF2 files start with `wOFF2`, which also begins with `wOFF`. */
private val WOFF_HEADER = "wOFF".encodeToByteArray()

/** Returns true if [this] begins with [prefix]. */
private fun ByteArray.startsWith(prefix: ByteArray): Boolean {
    if (size < prefix.size) return false
    for (i in prefix.indices) {
        if (this[i] != prefix[i]) return false
    }
    return true
}

/**
 * Returns true if [data] begins with a known font file header:
 * SFNT (TTF/OTF) version 1.0 (`00 01 00 00`) or WOFF/WOFF2 (`wOFF` / `wOFF2`).
 */
private fun hasFontHeader(data: ByteArray): Boolean {
    if (data.size < 4) return false
    return data.startsWith(SFNT_HEADER) || data.startsWith(WOFF_HEADER)
}
