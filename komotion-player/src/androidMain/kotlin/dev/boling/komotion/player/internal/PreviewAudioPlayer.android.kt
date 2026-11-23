package dev.boling.komotion.player.internal

import android.media.MediaPlayer

internal actual fun createPreviewAudioPlayer(): PreviewAudioPlayer = AndroidPreviewAudioPlayer()

/**
 * Android preview audio backed by [MediaPlayer].
 *
 * [MediaPlayer.seekTo] takes milliseconds; the controller passes seconds, so
 * this implementation converts. Volume and mute are applied via
 * [MediaPlayer.setVolume].
 */
internal class AndroidPreviewAudioPlayer : PreviewAudioPlayer {

    private var player: MediaPlayer? = null
    private var playing = false
    private var volume: Float = 1f
    private var muted = false

    override fun load(file: String) {
        player = MediaPlayer().apply {
            setDataSource(file)
            prepare()
            setVolume(if (muted) 0f else volume, if (muted) 0f else volume)
        }
    }

    override fun seekTo(seconds: Double) {
        player?.seekTo((seconds * 1000).toInt())
    }

    override fun play() {
        player?.start()
        playing = true
    }

    override fun pause() {
        player?.pause()
        playing = false
    }

    override fun stop() {
        player?.stop()
        // stop() puts the player in the Initialized state; prepare() again so
        // it can be started from the beginning on the next play().
        player?.prepare()
        playing = false
    }

    override fun setVolume(volume: Float) {
        this.volume = volume.coerceIn(0f, 1f)
        if (!muted) {
            player?.setVolume(this.volume, this.volume)
        }
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        player?.setVolume(if (muted) 0f else volume, if (muted) 0f else volume)
    }

    override val isPlaying: Boolean
        get() = playing

    override fun dispose() {
        player?.release()
        player = null
    }
}
