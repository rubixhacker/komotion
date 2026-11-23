@file:OptIn(ExperimentalWasmJsInterop::class)

package dev.boling.komotion.core

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.platform.Font
import kotlin.js.ExperimentalWasmJsInterop
import kotlin.js.JsAny

actual class FontAsset actual constructor(path: String) {
    actual val path: String = path
    actual val data: ByteArray = loadFontData(path)

    actual fun toFontFamily(): FontFamily = FontFamily(Font(path, data))
}

// The font is loaded with a synchronous XMLHttpRequest: the browser main thread
// is the only place a font URL can be read without suspending, and a
// FontAsset must be fully loaded before komotionFont can provide its
// FontFamily. A failed request (network error, 404, ...) throws instead of
// falling back to a system font.
private fun loadFontData(path: String): ByteArray {
    val xhr = XMLHttpRequest()
    try {
        xhr.open("GET", path, false)
        xhr.responseType = "arraybuffer"
        xhr.send()
    } catch (e: Throwable) {
        throw IllegalArgumentException("Font file not found: $path", e)
    }
    if (xhr.status != 200) {
        throw IllegalArgumentException("Font file not found: $path (HTTP ${xhr.status})")
    }
    val data = arrayBufferToByteArray(xhr.response)
    requireFontData(path, data)
    return data
}

private fun arrayBufferToByteArray(buffer: JsAny): ByteArray {
    val view = DataView(buffer)
    val bytes = ByteArray(view.byteLength)
    for (i in 0 until view.byteLength) {
        bytes[i] = view.getInt8(i).toByte()
    }
    return bytes
}

private external class XMLHttpRequest {
    fun open(method: String, url: String, async: Boolean)
    var responseType: String
    var response: JsAny
    fun send()
    val status: Int
}

private external class DataView(buffer: JsAny) {
    val byteLength: Int
    fun getInt8(index: Int): Int
}
