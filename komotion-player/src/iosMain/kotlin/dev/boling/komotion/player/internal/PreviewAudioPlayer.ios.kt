package dev.boling.komotion.player.internal

import platform.AVFAudio.AVAudioPlayer
import platform.Foundation.NSURL

internal actual fun createPreviewAudioPlayer(): PreviewAudioPlayer = IosPreviewAudioPlayer()

/**
 * iOS preview audio backed by [AVAudioPlayer].
 *
 * [AVAudioPlayer.currentTime] is in seconds, so seeking is a direct
 * assignment. Volume and mute are applied via [AVAudioPlayer.volume].
 */
internal class IosPreviewAudioPlayer : PreviewAudioPlayer {

    private var player: AVAudioPlayer? = null
    private var volume: Float = 1f
    private var muted = false

    @OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
    override fun load(file: String) {
        val url = NSURL.fileURLWithPath(file)
        val newPlayer = AVAudioPlayer(url, null) ?: return
        newPlayer.prepareToPlay()
        newPlayer.volume = if (muted) 0f else volume
        player = newPlayer
    }

    override fun seekTo(seconds: Double) {
        player?.currentTime = seconds
    }

    override fun play() {
        player?.play()
    }

    override fun pause() {
        player?.pause()
    }

    override fun stop() {
        player?.stop()
        player?.currentTime = 0.0
    }

    override fun setVolume(volume: Float) {
        this.volume = volume.coerceIn(0f, 1f)
        if (!muted) {
            player?.volume = this.volume
        }
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        player?.volume = if (muted) 0f else volume
    }

    override val isPlaying: Boolean
        get() = player?.isPlaying() == true

    override fun dispose() {
        player?.stop()
        player = null
    }
}
