package dev.boling.komotion.player

/**
 * An event emitted by a [KomotionPlayer] and observed through
 * [KomotionPlayerController.events].
 */
sealed interface KomotionPlayerEvent {
    /** Emitted when playback starts or resumes. */
    data object Play : KomotionPlayerEvent

    /** Emitted when playback is paused. */
    data object Pause : KomotionPlayerEvent

    /** Emitted after a seek completes. */
    data object Seeked : KomotionPlayerEvent

    /** Emitted whenever the displayed frame changes. */
    data class FrameUpdate(val frame: Int) : KomotionPlayerEvent

    /** Emitted when playback reaches the end of the window without looping. */
    data object Ended : KomotionPlayerEvent

    /**
     * Emitted when the player encounters an error; the message is also
     * recorded in [KomotionPlayerState.error].
     */
    data class Error(val message: String) : KomotionPlayerEvent
}
