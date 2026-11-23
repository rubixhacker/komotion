package dev.boling.komotion.core

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.platform.Font
import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.allocArray
import kotlinx.cinterop.get
import kotlinx.cinterop.memScoped
import platform.posix.SEEK_END
import platform.posix.SEEK_SET
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.fseek
import platform.posix.ftell

actual class FontAsset actual constructor(path: String) {
    actual val path: String = path
    actual val data: ByteArray = loadFontData(path)

    actual fun toFontFamily(): FontFamily = FontFamily(Font(path, data))
}

@OptIn(ExperimentalForeignApi::class)
private fun loadFontData(path: String): ByteArray {
    val file = fopen(path, "r") ?: throw IllegalArgumentException("Font file not found: $path")
    try {
        fseek(file, 0, SEEK_END)
        val size = ftell(file).toInt()
        fseek(file, 0, SEEK_SET)
        val data = ByteArray(size)
        if (size > 0) {
            memScoped {
                val buffer = allocArray<ByteVar>(size)
                val read = fread(buffer, 1.toULong(), size.toULong(), file)
                if (read != size.toULong()) {
                    throw IllegalArgumentException("Font file is unreadable: $path")
                }
                for (i in 0 until size) {
                    data[i] = buffer[i].toByte()
                }
            }
        }
        requireFontData(path, data)
        return data
    } finally {
        fclose(file)
    }
}
