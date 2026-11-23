package dev.boling.komotion.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import kotlin.js.js

private fun requestDocumentFullscreen() {
    // Single-expression js() call, as required in Kotlin/Wasm. The page-level
    // guard and try/catch keep failures (e.g. no user gesture) silent.
    js("if (document && document.documentElement) { try { document.documentElement.requestFullscreen() } catch (e) {} }")
}

private fun exitDocumentFullscreen() {
    js("if (document && document.exitFullscreen) { try { document.exitFullscreen() } catch (e) {} }")
}

/**
 * Best-effort use of the browser Fullscreen API: the request is made where
 * the page allows it, and failures (e.g. no user gesture) are swallowed.
 */
@Composable
internal actual fun rememberPlatformFullscreen(): PlatformFullscreen = remember {
    object : PlatformFullscreen {
        override val isSupported = true
        override fun enter(): Boolean {
            requestDocumentFullscreen()
            return true
        }
        override fun exit() {
            exitDocumentFullscreen()
        }
    }
}
