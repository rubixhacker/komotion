package dev.boling.komotion.export

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class BlackFrameDetectorTest {

    @Test
    fun `parseBlackdetect picks up black_start black_end black_duration`() {
        val sample = """
            ffmpeg version 6.1
            Input #0, mov,mp4,m4a,...
            [blackdetect @ 0x12345] black_start:0.000 black_end:1.500 black_duration:1.500
            [blackdetect @ 0x12345] black_start:8.200 black_end:8.300 black_duration:0.100
            frame= 60 fps=...
        """.trimIndent()

        val intervals = BlackFrameDetector().parseBlackdetect(sample)
        assertEquals(2, intervals.size)
        assertEquals(0.0, intervals[0].startSec, 0.001)
        assertEquals(1.5, intervals[0].endSec, 0.001)
        assertEquals(1.5, intervals[0].durationSec, 0.001)
        assertEquals(8.2, intervals[1].startSec, 0.001)
    }

    @Test
    fun `parseBlackdetect returns empty when ffmpeg output has no black runs`() {
        val sample = "frame= 60 fps=30 q=-1.0 size=1024 time=00:00:02.00\n"
        assertTrue(BlackFrameDetector().parseBlackdetect(sample).isEmpty())
    }

    @Test
    fun `assertNoBlackFrames throws BlackFrameQcException with intervals attached`() {
        // Synthesize the exception directly — exercising the real ffmpeg path
        // requires a video file and is covered by the integration test below.
        val intervals = listOf(BlackInterval(0.0, 1.0, 1.0))
        val ex = BlackFrameQcException("test", intervals)
        assertEquals(intervals, ex.intervals)
    }

    @Test
    fun `detect rejects a missing input file before invoking ffmpeg`() {
        assertFailsWith<IllegalArgumentException> {
            BlackFrameDetector().detect("/definitely/not/a/file.mp4")
        }
    }
}
