package dev.boling.komotion.player

import dev.boling.komotion.player.internal.createPreviewAudioPlayer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Exercises the real desktop [dev.boling.komotion.player.internal.PreviewAudioPlayer]
 * implementation with generated WAV files.
 */
class DesktopPreviewAudioPlayerTest {

    /** Builds a minimal PCM WAV file with a sine wave. */
    private fun wavBytes(
        durationSeconds: Double,
        sampleRate: Int = 44100,
        channels: Int = 1,
        bitsPerSample: Int = 16,
    ): ByteArray {
        val frameSize = channels * (bitsPerSample / 8)
        val samplesPerChannel = (durationSeconds * sampleRate).toInt()
        val dataLength = samplesPerChannel * frameSize
        val out = ByteBuffer.allocate(44 + dataLength).order(ByteOrder.LITTLE_ENDIAN)
        out.put("RIFF".toByteArray())
        out.int(36 + dataLength)
        out.put("WAVE".toByteArray())
        out.put("fmt ".toByteArray())
        out.int(16)
        out.short(1) // PCM
        out.short(channels)
        out.int(sampleRate)
        out.int(sampleRate * frameSize)
        out.short(frameSize)
        out.short(bitsPerSample)
        out.put("data".toByteArray())
        out.int(dataLength)
        val max = (1 shl (bitsPerSample - 1)) - 1
        for (i in 0 until samplesPerChannel) {
            val sample = (sin(2.0 * PI * i * 440.0 / sampleRate) * max).toInt()
            for (c in 0 until channels) {
                when (bitsPerSample) {
                    16 -> out.short(sample)
                    24 -> {
                        out.short(sample)
                        out.byte(0)
                    }
                }
            }
        }
        return out.array()
    }

    private fun tempWav(name: String, bytes: ByteArray): File {
        val file = File.createTempFile(name, ".wav")
        file.deleteOnExit()
        file.writeBytes(bytes)
        return file
    }

    @Test
    fun `load accepts a 16-bit PCM WAV and the transport works`() {
        val file = tempWav("komotion-test-16bit", wavBytes(0.5))
        val player = createPreviewAudioPlayer()
        try {
            player.load(file.absolutePath)
            player.seekTo(0.25)
            player.play()
            player.pause()
            player.stop()
            assertFalse(player.isPlaying)
        } finally {
            player.dispose()
        }
    }

    @Test
    fun `load accepts a 48 kHz stereo 16-bit PCM WAV`() {
        val file = tempWav("komotion-test-stereo", wavBytes(0.2, sampleRate = 48000, channels = 2))
        val player = createPreviewAudioPlayer()
        try {
            player.load(file.absolutePath)
            player.seekTo(0.1)
            player.play()
            player.pause()
        } finally {
            player.dispose()
        }
    }

    @Test
    fun `load leaves the player silent for an unsupported WAV format`() {
        val file = tempWav("komotion-test-24bit", wavBytes(0.2, bitsPerSample = 24))
        val player = createPreviewAudioPlayer()
        try {
            player.load(file.absolutePath)
            player.play()
            assertFalse(player.isPlaying, "Unsupported format must not start playback")
        } finally {
            player.dispose()
        }
    }

    @Test
    fun `load leaves the player silent for a missing file`() {
        val player = createPreviewAudioPlayer()
        try {
            player.load("/nonexistent/path/to/audio.wav")
            player.play()
            assertFalse(player.isPlaying)
        } finally {
            player.dispose()
        }
    }

    private fun ByteBuffer.int(value: Int) = putInt(value)
    private fun ByteBuffer.short(value: Int) = putShort(value.toShort())
    private fun ByteBuffer.byte(value: Int) = put(value.toByte())
}
