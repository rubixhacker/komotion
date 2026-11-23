package dev.boling.komotion.player

import dev.boling.komotion.media.AudioMedia
import dev.boling.komotion.player.internal.PreviewAudioController
import dev.boling.komotion.player.internal.PreviewAudioPlayer
import dev.boling.komotion.player.internal.filePositionSeconds
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PreviewAudioControllerTest {

    /** A fake player that records the calls made to it. */
    private class FakePlayer : PreviewAudioPlayer {
        val calls = mutableListOf<String>()
        var loadedFile: String? = null
        var playing = false

        override fun load(file: String) {
            calls += "load($file)"
            loadedFile = file
        }

        override fun seekTo(seconds: Double) {
            calls += "seekTo(${seconds})"
        }

        override fun play() {
            calls += "play"
            playing = true
        }

        override fun pause() {
            calls += "pause"
            playing = false
        }

        override fun stop() {
            calls += "stop"
            playing = false
        }

        override fun setVolume(volume: Float) {
            calls += "setVolume(${volume})"
        }

        override fun setMuted(muted: Boolean) {
            calls += "setMuted(${muted})"
        }

        override val isPlaying: Boolean
            get() = playing

        override fun dispose() {
            calls += "dispose"
        }
    }

    @Test
    fun `filePositionSeconds accounts for start trim rate and end`() {
        val declaration = AudioMedia(
            file = "/a.wav",
            startFrame = 30,
            playbackRate = 2f,
            trimStartFrame = 5,
            trimEndFrame = 90,
        )
        // At frame 30 (start), position = 5/30 seconds
        assertEquals(5.0 / 30.0, filePositionSeconds(declaration, 30, 30), 1e-9)
        // At frame 60 (30 frames after start), position = 5/30 + 30*2/30
        assertEquals(5.0 / 30.0 + 30.0 * 2.0 / 30.0, filePositionSeconds(declaration, 60, 30), 1e-9)
        // At frame 90, position would exceed the trim end (90/30) and is clamped
        assertEquals(90.0 / 30.0, filePositionSeconds(declaration, 90, 30), 1e-9)
    }

    @Test
    fun `audio plays during playback and stops on pause`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 0)

        controller.sync(listOf(declaration), frame = 0, fps = 30, playing = true)
        assertTrue(player.calls.contains("play"), "Expected play, got ${player.calls}")
        assertTrue(player.isPlaying)

        controller.sync(listOf(declaration), frame = 0, fps = 30, playing = false)
        assertTrue(player.calls.contains("pause"), "Expected pause, got ${player.calls}")
        assertTrue(!player.isPlaying)
    }

    @Test
    fun `audio is silent before its startFrame`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 30)

        controller.sync(listOf(declaration), frame = 10, fps = 30, playing = true)
        assertTrue(player.calls.contains("stop"), "Expected stop, got ${player.calls}")
        assertTrue(!player.isPlaying)
    }

    @Test
    fun `seek repositions audio to the new frame's time`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 0)

        controller.sync(listOf(declaration), frame = 0, fps = 30, playing = true)
        // Scrub to frame 30 (a jump of 30 frames)
        controller.sync(listOf(declaration), frame = 30, fps = 30, playing = true)
        assertTrue(player.calls.contains("seekTo(1.0)"), "Expected seekTo(1.0), got ${player.calls}")
    }

    @Test
    fun `volume and mute from declaration and player combine`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 0, volume = 0.5f, muted = false)

        controller.sync(
            listOf(declaration),
            frame = 0,
            fps = 30,
            playing = true,
            playerVolume = 0.5f,
            playerMuted = true,
        )
        // Effective volume = 0.5 * 0.5 = 0.25
        assertTrue(player.calls.contains("setVolume(0.25)"), "Expected setVolume(0.25), got ${player.calls}")
        // Effective mute = false || true = true
        assertTrue(player.calls.contains("setMuted(true)"), "Expected setMuted(true), got ${player.calls}")
    }

    @Test
    fun `normal playback advance does not seek`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 0)

        // Initial play starts with a seek to the start position.
        controller.sync(listOf(declaration), frame = 0, fps = 30, playing = true)
        val seeksAfterStart = player.calls.filter { it.startsWith("seekTo") }.size
        // Advance by one frame (normal playback)
        controller.sync(listOf(declaration), frame = 1, fps = 30, playing = true)
        val seeks = player.calls.filter { it.startsWith("seekTo") }.size
        assertEquals(seeksAfterStart, seeks, "Expected no new seeks, got ${player.calls}")
    }

    @Test
    fun `player-level mute alone mutes the audio`() {
        val player = FakePlayer()
        val controller = PreviewAudioController { player }
        val declaration = AudioMedia(file = "/a.wav", startFrame = 0, volume = 1f, muted = false)

        controller.sync(
            listOf(declaration),
            frame = 0,
            fps = 30,
            playing = true,
            playerMuted = true,
        )
        assertTrue(player.calls.contains("setMuted(true)"), "Expected setMuted(true), got ${player.calls}")
    }
}
