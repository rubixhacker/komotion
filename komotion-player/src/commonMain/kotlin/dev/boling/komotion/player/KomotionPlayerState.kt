package dev.boling.komotion.player

/**
 * The observable state of a [KomotionPlayer] as seen through
 * [KomotionPlayerController.state].
 *
 * @property frame The currently displayed frame index.
 * @property isPlaying Whether playback is active.
 * @property loop Whether playback loops at the end of the window.
 * @property playbackRate Playback speed multiplier (1.0 = normal speed).
 * @property volume Playback volume in the range 0.0 (silent) to 1.0 (full).
 * @property muted Whether playback is muted.
 * @property fullscreen Whether the player is in (or has requested) fullscreen.
 * @property error A human-readable description of the last error, or null if
 *   the player is in a healthy state.
 */
data class KomotionPlayerState(
    val frame: Int = 0,
    val isPlaying: Boolean = false,
    val loop: Boolean = true,
    val playbackRate: Float = 1f,
    val volume: Float = 1f,
    val muted: Boolean = false,
    val fullscreen: Boolean = false,
    val error: String? = null,
)
