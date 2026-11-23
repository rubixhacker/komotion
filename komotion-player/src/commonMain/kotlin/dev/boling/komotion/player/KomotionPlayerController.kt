package dev.boling.komotion.player

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A programmable handle to a [KomotionPlayer].
 *
 * Pass an instance to [KomotionPlayer] to drive the player from outside the
 * composition and observe what it does:
 *
 * ```kotlin
 * val controller = KomotionPlayerController()
 * KomotionPlayer(composition, controller = controller) { ... }
 *
 * controller.play()
 * controller.seekTo(30)
 * controller.state.collect { println(it.frame) }
 * controller.events.collect { println(it) }
 * ```
 *
 * The controller is a facade: command methods ([play], [pause], [toggle],
 * [seekTo], [setVolume], [mute], [requestFullscreen]) are delivered to the
 * player, which applies them to its own state; the player then publishes its
 * state through [state] and reports what happened through [events].
 */
class KomotionPlayerController(
    initialState: KomotionPlayerState = KomotionPlayerState(),
) {
    /**
     * Internal: the player composable publishes its state through this flow
     * and reads it back as [state].
     */
    internal val _state = MutableStateFlow(initialState)

    /** The player's current state, as reported by the player it is attached to. */
    val state: StateFlow<KomotionPlayerState> = _state.asStateFlow()

    /**
     * Internal: the player composable emits events through this flow and
     * readers observe them as [events].
     */
    internal val _events = MutableSharedFlow<KomotionPlayerEvent>(extraBufferCapacity = 256)

    /**
     * Events emitted by the player: [KomotionPlayerEvent.Play],
     * [KomotionPlayerEvent.Pause], [KomotionPlayerEvent.Seeked],
     * [KomotionPlayerEvent.FrameUpdate], [KomotionPlayerEvent.Ended] and
     * [KomotionPlayerEvent.Error].
     */
    val events: Flow<KomotionPlayerEvent> = _events.asSharedFlow()

    /** Internal: the player composable collects commands from this flow. */
    internal val _commands = MutableSharedFlow<KomotionPlayerCommand>(extraBufferCapacity = 64)

    /** Starts or resumes playback. */
    fun play() {
        _commands.tryEmit(KomotionPlayerCommand.Play)
    }

    /** Stops playback. */
    fun pause() {
        _commands.tryEmit(KomotionPlayerCommand.Pause)
    }

    /** Starts playback if paused, pauses if playing. */
    fun toggle() {
        _commands.tryEmit(KomotionPlayerCommand.Toggle)
    }

    /**
     * Pauses playback and moves to [frame].
     *
     * Frames outside the player's window are clamped to it; frames outside
     * the composition's range are rejected with a [KomotionPlayerEvent.Error].
     */
    fun seekTo(frame: Int) {
        _commands.tryEmit(KomotionPlayerCommand.SeekTo(frame))
    }

    /** Sets the playback volume, clamped to the range 0.0..1.0. */
    fun setVolume(volume: Float) {
        _commands.tryEmit(KomotionPlayerCommand.SetVolume(volume))
    }

    /** Toggles the muted state. */
    fun mute() {
        _commands.tryEmit(KomotionPlayerCommand.Mute)
    }

    /** Requests fullscreen where the platform supports it. */
    fun requestFullscreen() {
        _commands.tryEmit(KomotionPlayerCommand.RequestFullscreen)
    }

    /**
     * Internal: the player composable collects commands from this flow and
     * applies them to its state.
     */
    internal val commands: SharedFlow<KomotionPlayerCommand> = _commands.asSharedFlow()
}

/** Internal: a command sent by [KomotionPlayerController] to the player. */
internal sealed interface KomotionPlayerCommand {
    data object Play : KomotionPlayerCommand
    data object Pause : KomotionPlayerCommand
    data object Toggle : KomotionPlayerCommand
    data class SeekTo(val frame: Int) : KomotionPlayerCommand
    data class SetVolume(val volume: Float) : KomotionPlayerCommand
    data object Mute : KomotionPlayerCommand
    data object RequestFullscreen : KomotionPlayerCommand
}
