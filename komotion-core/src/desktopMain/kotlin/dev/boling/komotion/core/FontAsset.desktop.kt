package dev.boling.komotion.core

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.platform.Font
import java.io.File

actual class FontAsset actual constructor(path: String) {
    actual val path: String = path
    actual val data: ByteArray = loadFontData(path)

    actual fun toFontFamily(): FontFamily = FontFamily(Font(path, data))
}

private fun loadFontData(path: String): ByteArray {
    val file = File(path)
    require(file.isFile) { "Font file not found: $path" }
    val data = file.readBytes()
    requireFontData(path, data)
    return data
}
