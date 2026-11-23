package dev.boling.komotion.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

@Composable
internal actual fun rememberPlatformFullscreen(): PlatformFullscreen = remember {
    object : PlatformFullscreen {
        override val isSupported get() = !java.awt.GraphicsEnvironment.isHeadless()

        override fun enter(): Boolean {
            if (!isSupported) return false
            return try {
                val window = focusedWindow() ?: return false
                val device = window.graphicsConfiguration.device
                if (!device.isFullScreenSupported()) return false
                device.setFullScreenWindow(window)
                true
            } catch (e: Throwable) {
                false
            }
        }

        override fun exit() {
            try {
                val window = focusedWindow() ?: return
                val device = window.graphicsConfiguration.device
                if (device.fullScreenWindow == window) {
                    device.setFullScreenWindow(null)
                }
            } catch (e: Throwable) {
                // Not in fullscreen, or the platform refused; nothing to do.
            }
        }

        private fun focusedWindow(): java.awt.Window? =
            java.awt.Window.getWindows().firstOrNull { it.isFocused }
                ?: java.awt.Window.getWindows().firstOrNull { it.isShowing }
    }
}
