package dev.boling.komotion.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * Compose for iOS renders inside a UIKit view managed by the host app; a
 * sub-view cannot take over the screen on its own. The player's fullscreen
 * state still works, the platform request is a no-op.
 */
@Composable
internal actual fun rememberPlatformFullscreen(): PlatformFullscreen = remember {
    object : PlatformFullscreen {
        override val isSupported = false
        override fun enter(): Boolean = false
        override fun exit() {}
    }
}
