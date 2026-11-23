package dev.boling.komotion.core

import android.graphics.Typeface
import androidx.compose.ui.text.font.FontFamily
import java.io.File

actual class FontAsset actual constructor(path: String) {
    actual val path: String = path
    actual val data: ByteArray = loadFontData(path)

    actual fun toFontFamily(): FontFamily {
        val typeface = Typeface.createFromFile(path)
            ?: throw IllegalArgumentException("Font file is not a valid font: $path")
        return FontFamily(typeface)
    }
}

private fun loadFontData(path: String): ByteArray {
    val file = File(path)
    require(file.isFile) { "Font file not found: $path" }
    val data = file.readBytes()
    requireFontData(path, data)
    return data
}
