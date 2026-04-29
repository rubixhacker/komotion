package dev.boling.komotion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SegmentTest {

    @Test
    fun `validateAudioSegments passes when keys exactly cover 0 until segmentCount`() {
        validateAudioSegments(
            segmentCount = 3,
            audioSegments = mapOf(
                0 to AudioTrack("/audio/0.wav"),
                1 to AudioTrack("/audio/1.wav"),
                2 to AudioTrack("/audio/2.wav"),
            ),
        )
        validateAudioSegments(0, emptyMap())
    }

    @Test
    fun `validateAudioSegments throws when an index is missing`() {
        val ex = assertFailsWith<SegmentValidationException> {
            validateAudioSegments(
                segmentCount = 3,
                audioSegments = mapOf(
                    0 to AudioTrack("/audio/0.wav"),
                    2 to AudioTrack("/audio/2.wav"),
                ),
            )
        }
        assertTrue(ex.message!!.contains("Missing audio for segments: [1]"), "actual: ${ex.message}")
        assertTrue(ex.message!!.contains("expected 3"), "actual: ${ex.message}")
    }

    @Test
    fun `validateAudioSegments throws when extra keys exist`() {
        val ex = assertFailsWith<SegmentValidationException> {
            validateAudioSegments(
                segmentCount = 2,
                audioSegments = mapOf(
                    0 to AudioTrack("/audio/0.wav"),
                    1 to AudioTrack("/audio/1.wav"),
                    7 to AudioTrack("/audio/7.wav"),
                ),
            )
        }
        assertTrue(ex.message!!.contains("Unexpected audio keys"), "actual: ${ex.message}")
        assertTrue(ex.message!!.contains("[7]"), "actual: ${ex.message}")
    }

    @Test
    fun `validateAudioSegments error message names both missing and extra entries`() {
        val ex = assertFailsWith<SegmentValidationException> {
            validateAudioSegments(
                segmentCount = 3,
                audioSegments = mapOf(
                    0 to AudioTrack("/0.wav"),
                    5 to AudioTrack("/5.wav"),
                ),
            )
        }
        assertTrue(ex.message!!.contains("[1, 2]"), "missing list, actual: ${ex.message}")
        assertTrue(ex.message!!.contains("[5]"), "extra list, actual: ${ex.message}")
    }

    @Test
    fun `validateSegments passes for a clean segment list`() {
        val composition = Composition(1920, 1080, durationInFrames = 300, fps = 30)
        validateSegments(
            composition,
            listOf(
                Segment(0, from = 0, durationInFrames = 100),
                Segment(1, from = 100, durationInFrames = 100),
                Segment(2, from = 200, durationInFrames = 100),
            ),
        )
    }

    @Test
    fun `validateSegments rejects a segment that runs past composition end`() {
        val composition = Composition(1920, 1080, durationInFrames = 100, fps = 30)
        val ex = assertFailsWith<SegmentValidationException> {
            validateSegments(
                composition,
                listOf(
                    Segment(0, from = 0, durationInFrames = 100),
                    Segment(1, from = 100, durationInFrames = 50),
                ),
            )
        }
        assertTrue(ex.message!!.contains("past composition.durationInFrames"), "actual: ${ex.message}")
    }

    @Test
    fun `validateSegments rejects duplicate indices`() {
        val composition = Composition(1920, 1080, durationInFrames = 300, fps = 30)
        val ex = assertFailsWith<SegmentValidationException> {
            validateSegments(
                composition,
                listOf(
                    Segment(0, 0, 100),
                    Segment(0, 100, 100),
                ),
            )
        }
        assertTrue(ex.message!!.contains("Duplicate segment indices"), "actual: ${ex.message}")
    }

    @Test
    fun `validateSegments folds in audio mismatch`() {
        val composition = Composition(1920, 1080, durationInFrames = 300, fps = 30)
        val ex = assertFailsWith<SegmentValidationException> {
            validateSegments(
                composition,
                listOf(
                    Segment(0, 0, 100),
                    Segment(1, 100, 100),
                ),
                audioSegments = mapOf(0 to AudioTrack("/0.wav")),
            )
        }
        assertTrue(ex.message!!.contains("Missing audio for segments"), "actual: ${ex.message}")
    }

    @Test
    fun `audioTracksFromSegments uses segment from as start frame`() {
        val segments = listOf(
            Segment(0, from = 10, durationInFrames = 50),
            Segment(1, from = 60, durationInFrames = 50),
        )
        val tracks = audioTracksFromSegments(
            segments = segments,
            audioSegments = mapOf(
                0 to AudioTrack("/a.wav", startFrame = 999),
                1 to AudioTrack("/b.wav", startFrame = 999),
            ),
        )
        assertEquals(listOf(10, 60), tracks.map { it.startFrame })
        assertEquals(listOf("/a.wav", "/b.wav"), tracks.map { it.file })
    }

    @Test
    fun `audioTracksFromSegments validates before producing tracks`() {
        assertFailsWith<SegmentValidationException> {
            audioTracksFromSegments(
                segments = listOf(Segment(0, 0, 30), Segment(1, 30, 30)),
                audioSegments = mapOf(0 to AudioTrack("/a.wav")),
            )
        }
    }
}
