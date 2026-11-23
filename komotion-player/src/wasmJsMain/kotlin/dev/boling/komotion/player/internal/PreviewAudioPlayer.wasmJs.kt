package dev.boling.komotion.player.internal

import kotlinx.browser.document
import org.w3c.dom.HTMLAudioElement

internal actual fun createPreviewAudioPlayer(): PreviewAudioPlayer = WasmPreviewAudioPlayer()

/**
 * wasmJs preview audio backed by the browser's HTML `Audio` element.
 *
 * `currentTime` is in seconds, so seeking is a direct assignment. Volume and
 * mute are applied via the element's `volume` property.
 */
internal class WasmPreviewAudioPlayer : PreviewAudioPlayer {

    private var audio: HTMLAudioElement? = null
    private var volume: Float = 1f
    private var muted = false

    override fun load(file: String) {
        val newAudio = document.createElement("audio") as HTMLAudioElement
        newAudio.setAttribute("src", file)
        newAudio.volume = if (muted) 0.0 else volume.toDouble()
        audio = newAudio
    }

    override fun seekTo(seconds: Double) {
        audio?.currentTime = seconds
    }

    override fun play() {
        // play() returns a Promise; the result is not needed here.
        audio?.play()
    }

    override fun pause() {
        audio?.pause()
    }

    override fun stop() {
        audio?.pause()
        audio?.currentTime = 0.0
    }

    override fun setVolume(volume: Float) {
        this.volume = volume.coerceIn(0f, 1f)
        if (!muted) {
            audio?.volume = this.volume.toDouble()
        }
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        audio?.volume = if (muted) 0.0 else volume.toDouble()
    }

    override val isPlaying: Boolean
        get() {
            val current = audio ?: return false
            return !current.paused
        }

    override fun dispose() {
        audio?.pause()
        audio = null
    }
}
