package dev.boling.komotion.player.internal

import dev.boling.komotion.media.AudioMedia
import kotlin.math.abs

/**
 * A small internal interface for previewing a single audio file.
 *
 * Implementations are platform-specific (native players). The
 * [PreviewAudioController] drives them based on the current frame and
 * playback state. Preview playback is best-effort: it makes declared
 * [AudioMedia] audible while the Player plays, pauses, seeks and ends.
 */
internal interface PreviewAudioPlayer {
    /** Load and prepare [file] for playback. */
    fun load(file: String)

    /** Seek to [seconds] into the file. */
    fun seekTo(seconds: Double)

    /** Start or resume playback. */
    fun play()

    /** Pause playback. */
    fun pause()

    /** Stop playback and reset to the start. */
    fun stop()

    /** Set the volume (0..1). */
    fun setVolume(volume: Float)

    /** Set mute. */
    fun setMuted(muted: Boolean)

    /** Whether the player is currently playing. */
    val isPlaying: Boolean

    /** Release resources. */
    fun dispose()
}

/**
 * Creates a platform-specific [PreviewAudioPlayer].
 */
internal expect fun createPreviewAudioPlayer(): PreviewAudioPlayer

/**
 * Computes the position (seconds) into the audio file for [declaration] at
 * [frame], given the composition's [fps].
 *
 * The position is measured from the start of the file, offset by the trim
 * start and scaled by the playback rate, clamped at the trim end.
 */
internal fun filePositionSeconds(declaration: AudioMedia, frame: Int, fps: Int): Double {
    val secondsSinceStart = (frame - declaration.startFrame).toDouble() / fps
    val position = declaration.trimStartFrame / fps.toDouble() + secondsSinceStart * declaration.playbackRate
    val trimEndSeconds = declaration.trimEndFrame?.toDouble()?.let { it / fps }
    return trimEndSeconds?.let { position.coerceAtMost(it) } ?: position
}

/**
 * Manages preview playback of the audio declarations collected by a
 * [dev.boling.komotion.media.MediaCollector].
 *
 * The player calls [sync] whenever the frame or playback state changes.
 * Audio is driven by the frame: a declaration is silent before its
 * [AudioMedia.startFrame], positioned at the frame's time while active, and
 * paused (or stopped) when playback pauses or ends.
 */
internal class PreviewAudioController(
    private val factory: () -> PreviewAudioPlayer = ::createPreviewAudioPlayer,
) {
    private val players = mutableMapOf<String, PreviewAudioPlayer>()
    private var lastFrame = Int.MIN_VALUE
    private var lastPlaying = false

    /**
     * Sync the audio to the current composition state.
     *
     * @param declarations The audio declarations collected from the composition.
     * @param frame The current frame.
     * @param fps The composition's frame rate.
     * @param playing Whether playback is active.
     * @param playerVolume Player-level volume multiplier (0..1).
     * @param playerMuted Player-level mute.
     */
    fun sync(
        declarations: List<AudioMedia>,
        frame: Int,
        fps: Int,
        playing: Boolean,
        playerVolume: Float = 1f,
        playerMuted: Boolean = false,
    ) {
        // A jump of more than one frame indicates a seek/scrub rather than
        // normal playback advance; seek the audio to the new frame's time.
        val isSeek = lastFrame != Int.MIN_VALUE && abs(frame - lastFrame) > 1
        val isPlayStart = playing && !lastPlaying
        lastFrame = frame
        lastPlaying = playing

        val activeFiles = declarations.mapTo(mutableSetOf()) { it.file }
        for ((file, player) in players.toList()) {
            if (file !in activeFiles) {
                player.stop()
                player.dispose()
                players.remove(file)
            }
        }

        for (declaration in declarations) {
            val player = players.getOrPut(declaration.file) {
                val p = factory()
                p.load(declaration.file)
                p
            }
            syncPlayer(player, declaration, frame, fps, playing, isSeek || isPlayStart, playerVolume, playerMuted)
        }
    }

    private fun syncPlayer(
        player: PreviewAudioPlayer,
        declaration: AudioMedia,
        frame: Int,
        fps: Int,
        playing: Boolean,
        shouldSeek: Boolean,
        playerVolume: Float,
        playerMuted: Boolean,
    ) {
        if (frame < declaration.startFrame) {
            player.stop()
            return
        }
        if (shouldSeek) {
            player.seekTo(filePositionSeconds(declaration, frame, fps))
        }
        if (playing) {
            player.play()
        } else {
            player.pause()
        }
        player.setVolume((declaration.volume * playerVolume).coerceIn(0f, 1f))
        player.setMuted(declaration.muted || playerMuted)
    }

    /** Release all resources. */
    fun dispose() {
        players.values.forEach { it.dispose() }
        players.clear()
    }
}
