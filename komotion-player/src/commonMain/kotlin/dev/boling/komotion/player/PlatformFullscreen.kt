package dev.boling.komotion.player

import androidx.compose.runtime.Composable

/**
 * Platform-specific fullscreen support for [KomotionPlayer].
 *
 * The player's [KomotionPlayerState.fullscreen] flag is the source of truth
 * for the UI; this hook performs the actual platform request where the
 * platform has one.
 */
internal interface PlatformFullscreen {
    /** Whether this platform can actually enter fullscreen. */
    val isSupported: Boolean

    /**
     * Requests fullscreen.
     *
     * @return true if the platform accepted the request.
     */
    fun enter(): Boolean

    /** Exits fullscreen if the platform is in it. */
    fun exit()
}

/**
 * Returns a [PlatformFullscreen] for the current platform, remembering it
 * across recompositions.
 */
@Composable
internal expect fun rememberPlatformFullscreen(): PlatformFullscreen
