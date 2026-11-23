package dev.boling.komotion.export

import dev.boling.komotion.core.AudioTrack
import dev.boling.komotion.core.Codec
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.ExportOptions
import dev.boling.komotion.core.FrameRange
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExportOptionsTest {

    private val composition = Composition(1080, 1920, 300, 30)
    private val renderer = FfmpegFrameRenderer()

    // --- expandFrameRange ---------------------------------------------------

    @Test
    fun `expandFrameRange single frame`() {
        assertEquals(listOf(5), renderer.expandFrameRange(listOf(FrameRange.of(5)), 10))
    }

    @Test
    fun `expandFrameRange range`() {
        assertEquals((2..7).toList(), renderer.expandFrameRange(listOf(FrameRange(2, 7)), 10))
    }

    @Test
    fun `expandFrameRange open-ended`() {
        assertEquals((4..9).toList(), renderer.expandFrameRange(listOf(FrameRange(4)), 10))
    }

    @Test
    fun `expandFrameRange concatenated ranges`() {
        assertEquals(
            listOf(0, 1, 4, 5, 9),
            renderer.expandFrameRange(listOf(FrameRange(0, 1), FrameRange(4, 5), FrameRange.of(9)), 10),
        )
    }

    @Test
    fun `expandFrameRange default options cover the whole composition`() {
        assertEquals((0..9).toList(), renderer.expandFrameRange(ExportOptions().frameRange, 10))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects start beyond the composition`() {
        renderer.expandFrameRange(listOf(FrameRange(10, 12)), 10)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects negative start`() {
        renderer.expandFrameRange(listOf(FrameRange(-1, 3)), 10)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects end beyond the composition`() {
        renderer.expandFrameRange(listOf(FrameRange(0, 12)), 10)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects empty range`() {
        renderer.expandFrameRange(listOf(FrameRange(5, 3)), 10)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects overlapping ranges`() {
        renderer.expandFrameRange(listOf(FrameRange(0, 4), FrameRange(3, 6)), 10)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `expandFrameRange rejects out-of-order ranges`() {
        renderer.expandFrameRange(listOf(FrameRange(4, 6), FrameRange(0, 2)), 10)
    }

    // --- scale ---------------------------------------------------------------

    @Test
    fun `buildFfmpegCommand scale adds a proportional scale filter`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(scale = 0.5),
        )
        val vfIndex = command.indexOf("-vf")
        assertTrue(vfIndex >= 0, "Expected -vf in $command")
        assertEquals("scale=540:960", command[vfIndex + 1])
    }

    @Test
    fun `buildFfmpegCommand default scale adds no scale filter`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
        )
        assertTrue(!command.contains("-vf"), "Expected no -vf in $command")
    }

    // --- codec ---------------------------------------------------------------

    @Test
    fun `buildFfmpegCommand default codec is libx264`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
        )
        assertEquals("libx264", command[command.indexOf("-vcodec") + 1])
    }

    @Test
    fun `buildFfmpegCommand H265 codec uses libx265`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(codec = Codec.H265),
        )
        assertEquals("libx265", command[command.indexOf("-vcodec") + 1])
    }

    @Test
    fun `buildFfmpegCommand Custom codec appends args verbatim`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(codec = Codec.Custom(listOf("-vcodec", "libx265", "-crf", "30"))),
        )
        assertEquals("libx265", command[command.indexOf("-vcodec") + 1])
        assertEquals("30", command[command.indexOf("-crf") + 1])
        assertTrue(!command.contains("-preset"), "Custom codec should not add a preset")
    }

    // --- muted ---------------------------------------------------------------

    @Test
    fun `buildFfmpegCommand muted drops audio inputs and filter`() {
        val tracks = listOf(AudioTrack(file = "/audio/hook.wav", startFrame = 0))
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = tracks,
            options = ExportOptions(muted = true),
        )
        assertTrue(!command.contains("/audio/hook.wav"), "muted should drop audio inputs")
        assertTrue(!command.contains("-filter_complex"), "muted should drop the audio filter")
        assertTrue(!command.contains("-map"), "muted should not map audio")
    }

    @Test
    fun `buildPipeFfmpegCommand muted drops audio inputs and filter`() {
        val tracks = listOf(AudioTrack(file = "/audio/hook.wav", startFrame = 0))
        val command = renderer.buildPipeFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = tracks,
            options = ExportOptions(muted = true),
        )
        assertTrue(!command.contains("/audio/hook.wav"))
        assertTrue(!command.contains("-filter_complex"))
    }

    // --- separateAudioTo -------------------------------------------------------

    @Test
    fun `buildFfmpegCommand separateAudioTo maps audio to a second output`() {
        val tracks = listOf(AudioTrack(file = "/audio/hook.wav", startFrame = 0))
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = tracks,
            options = ExportOptions(separateAudioTo = "/tmp/out.m4a"),
        )

        val mapIndices = command.indices.filter { command[it] == "-map" }
        assertEquals(2, mapIndices.size, "Expected one map per output: $command")
        assertEquals("0:v", command[mapIndices[0] + 1])
        assertEquals("[aout]", command[mapIndices[1] + 1])

        assertEquals("aac", command[command.indexOf("-c:a") + 1])
        assertTrue(command.contains(File("/tmp/out.m4a").absolutePath))
        // Video output comes before the audio output
        assertTrue(
            command.indexOf(File("/tmp/out.mp4").absolutePath) < command.indexOf(File("/tmp/out.m4a").absolutePath)
        )
    }

    @Test
    fun `buildFfmpegCommand separateAudioTo without audio tracks is ignored`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(separateAudioTo = "/tmp/out.m4a"),
        )
        assertTrue(!command.contains("-map"), "No audio, so no maps: $command")
        assertTrue(!command.contains(File("/tmp/out.m4a").absolutePath))
    }

    @Test
    fun `audioCodecFor picks the codec from the extension`() {
        assertEquals("pcm_s16le", renderer.audioCodecFor("/tmp/out.wav"))
        assertEquals("libmp3lame", renderer.audioCodecFor("/tmp/out.mp3"))
        assertEquals("adts", renderer.audioCodecFor("/tmp/out.aac"))
        assertEquals("aac", renderer.audioCodecFor("/tmp/out.m4a"))
        assertEquals("aac", renderer.audioCodecFor("/tmp/out"))
    }

    // --- metadata --------------------------------------------------------------

    @Test
    fun `buildFfmpegCommand metadata adds -metadata args`() {
        val command = renderer.buildFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(metadata = mapOf("title" to "Demo", "artist" to "Komotion")),
        )
        val first = command.indexOf("-metadata")
        assertTrue(first >= 0, "Expected -metadata in $command")
        assertEquals("title=Demo", command[first + 1])
        val second = first + 2 + command.subList(first + 2, command.size).indexOf("-metadata")
        assertTrue(second >= 0)
        assertEquals("artist=Komotion", command[second + 1])
    }

    // --- combined ---------------------------------------------------------------

    @Test
    fun `buildPipeFfmpegCommand combines scale codec and metadata`() {
        val command = renderer.buildPipeFfmpegCommand(
            ffmpeg = "ffmpeg",
            composition = composition,
            outputPath = "/tmp/out.mp4",
            audioTracks = emptyList(),
            options = ExportOptions(
                scale = 0.25,
                codec = Codec.H265,
                metadata = mapOf("title" to "Combined"),
            ),
        )
        val vfIndex = command.indexOf("-vf")
        assertTrue(vfIndex >= 0)
        assertEquals("scale=270:480", command[vfIndex + 1])
        assertEquals("libx265", command[command.indexOf("-vcodec") + 1])
        assertEquals("title=Combined", command[command.indexOf("-metadata") + 1])
    }
}
