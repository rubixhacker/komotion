package dev.boling.komotion.player.internal

import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.Line
import javax.sound.sampled.LineUnavailableException
import javax.sound.sampled.SourceDataLine
import java.io.File
import kotlin.concurrent.thread

internal actual fun createPreviewAudioPlayer(): PreviewAudioPlayer = DesktopPreviewAudioPlayer()

/**
 * Desktop preview audio backed by [javax.sound.sampled].
 *
 * Reads a decoded PCM (WAV) file into memory and writes it to a
 * [SourceDataLine] on a background thread. Seeking moves the read cursor;
 * volume and mute are applied as a per-sample gain.
 */
internal class DesktopPreviewAudioPlayer : PreviewAudioPlayer {

    private var data: ByteArray? = null
    private var sampleRate: Int = 44100
    private var channels: Int = 1
    private var bytesPerSample: Int = 2
    private var dataOffset: Long = 0
    private var dataLength: Long = 0
    private var position: Long = 0
    private var playing = false
    private var volume: Float = 1f
    private var muted = false
    private var line: SourceDataLine? = null
    private var thread: Thread? = null

    override fun load(file: String) {
        val bytes = File(file).takeIf { it.exists() }?.readBytes()
        data = bytes
        if (bytes != null) {
            parseWavHeader(bytes)
        }
        position = dataOffset
    }

    /** Minimal WAV header parse to locate the `data` chunk and the format. */
    private fun parseWavHeader(bytes: ByteArray) {
        if (bytes.size < 12) return
        // RIFF header
        if (bytes[0] != 'R'.code.toByte() || bytes[1] != 'I'.code.toByte()) return
        // Walk chunks to find the format and data chunks.
        var index = 12
        while (index + 8 <= bytes.size) {
            val chunkId = String(bytes, index, 4)
            val chunkSize = (bytes[index + 4].toInt() and 0xFF) +
                (bytes[index + 5].toInt() and 0xFF) shl 8 +
                (bytes[index + 6].toInt() and 0xFF) shl 16 +
                (bytes[index + 7].toInt() and 0xFF) shl 24
            when (chunkId) {
                "fmt " -> {
                    val audioFormat = bytes[index + 8].toInt() and 0xFF
                    channels = (bytes[index + 10].toInt() and 0xFF) +
                        (bytes[index + 11].toInt() and 0xFF) shl 8
                    sampleRate = (bytes[index + 12].toInt() and 0xFF) +
                        (bytes[index + 13].toInt() and 0xFF) shl 8 +
                        (bytes[index + 14].toInt() and 0xFF) shl 16 +
                        (bytes[index + 15].toInt() and 0xFF) shl 24
                    val bitsPerSample = (bytes[index + 16].toInt() and 0xFF) +
                        (bytes[index + 17].toInt() and 0xFF) shl 8
                    bytesPerSample = bitsPerSample / 8
                    // audioFormat is used to confirm PCM; we assume 16-bit PCM.
                    require(audioFormat == 1) { "Only 16-bit PCM WAV is supported for preview" }
                    require(bytesPerSample == 2) { "Only 16-bit samples are supported for preview" }
                    require(sampleRate > 0)
                    // fmt is parsed; keep the format for the line.
                    lineFormat = AudioFormat(sampleRate.toFloat(), sampleRate, channels, true, false)
                }
                "data" -> {
                    dataOffset = (index + 8).toLong()
                    dataLength = chunkSize.toLong()
                }
            }
            index += 8 + chunkSize
            if (chunkSize and 1 == 1) index++ // data chunks are padded to even size
        }
        if (dataOffset == 0L) {
            // No data chunk found; fall back to the format we have.
            dataOffset = 0
            dataLength = bytes.size.toLong()
        }
    }

    private var lineFormat: AudioFormat = AudioFormat(44100f, 44100, 1, true, false)

    override fun seekTo(seconds: Double) {
        val framePosition = (seconds * sampleRate).toLong()
        position = dataOffset + framePosition * channels * bytesPerSample
        if (position > dataOffset + dataLength) {
            position = dataOffset + dataLength
        }
    }

    override fun play() {
        if (playing || data == null) return
        playing = true
        ensureLine()
        thread = thread(name = "komotion-preview-audio") {
            playLoop()
        }
    }

    private fun playLoop() {
        val d = data ?: return
        val buffer = ByteArray(4096)
        val end = dataOffset + dataLength
        while (playing && position < end) {
            val toRead = minOf(buffer.size.toLong(), end - position)
            d.copyInto(buffer, 0, position.toInt(), (position + toRead).toInt())
            if (muted || volume < 1f) {
                applyGain(buffer, toRead)
            }
            line?.write(buffer, 0, toRead.toInt())
            position += toRead
            try {
                Thread.sleep(10)
            } catch (e: InterruptedException) {
                break
            }
        }
        playing = false
    }

    private fun applyGain(buffer: ByteArray, length: Long) {
        val gain = if (muted) 0f else volume
        if (gain >= 1f) return
        var i = 0
        var remaining = length
        while (remaining >= 2) {
            val sample = (buffer[i].toInt() and 0xFF) + (buffer[i + 1].toInt() and 0xFF) shl 8
            val scaled = (sample * gain).toInt().coerceIn(-32768, 32767)
            buffer[i] = (scaled and 0xFF).toByte()
            buffer[i + 1] = ((scaled shr 8) and 0xFF).toByte()
            i += 2
            remaining -= 2
        }
    }

    override fun pause() {
        playing = false
        thread?.interrupt()
        thread = null
    }

    override fun stop() {
        pause()
        position = dataOffset
    }

    override fun setVolume(volume: Float) {
        this.volume = volume.coerceIn(0f, 1f)
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
    }

    override val isPlaying: Boolean get() = playing

    override fun dispose() {
        pause()
        line?.close()
        line = null
    }

    private fun ensureLine() {
        if (line != null) return
        try {
            val info = AudioSystem.getSourceLineInfo(lineFormat as Line.Info)
            val candidate = info as? SourceDataLine ?: return
            candidate.open(lineFormat, 8192)
            candidate.start()
            line = candidate
        } catch (e: LineUnavailableException) {
            line = null
        }
    }
}
