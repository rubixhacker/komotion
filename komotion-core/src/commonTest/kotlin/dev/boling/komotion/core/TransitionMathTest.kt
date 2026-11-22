package dev.boling.komotion.core

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalKomotionApi::class)
class TransitionMathTest {

    // --- Timeline placement -------------------------------------------------

    @Test
    fun `total duration is sum of scenes minus overlaps`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        assertEquals(60, scope.totalDurationInFrames)
    }

    @Test
    fun `total duration with multiple transitions`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        scope.Wipe(durationInFrames = 15)
        scope.Scene(20) { }
        assertEquals(65, scope.totalDurationInFrames)
    }

    @Test
    fun `single scene total duration is its own duration`() {
        val scope = TransitionScope()
        scope.Scene(30) { }
        assertEquals(30, scope.totalDurationInFrames)
    }

    @Test
    fun `timeline places scenes and transition on overlap frames`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        val timeline = TransitionTimeline(scope.items)
        assertEquals(listOf(0, 30), timeline.scenes.map { it.startFrame })
        assertEquals(listOf(40, 30), timeline.scenes.map { it.durationInFrames })
        val t = timeline.transitions.single()
        assertEquals(30, t.startFrame)
        assertEquals(10, t.durationInFrames)
        assertEquals(timeline.scenes[0], t.outgoing)
        assertEquals(timeline.scenes[1], t.incoming)
    }

    @Test
    fun `multiple transitions alternate correctly`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        scope.Wipe(durationInFrames = 15)
        scope.Scene(20) { }
        val timeline = TransitionTimeline(scope.items)
        assertEquals(listOf(0, 30, 45), timeline.scenes.map { it.startFrame })
        assertEquals(listOf(30, 45), timeline.transitions.map { it.startFrame })
        assertEquals(65, timeline.totalDurationInFrames)
    }

    @Test
    fun `transition as first item is rejected`() {
        val scope = TransitionScope()
        scope.Fade(durationInFrames = 10)
        scope.Scene(30) { }
        assertFailsWith<IllegalArgumentException> { TransitionTimeline(scope.items) }
    }

    @Test
    fun `transition as last item is rejected`() {
        val scope = TransitionScope()
        scope.Scene(30) { }
        scope.Fade(durationInFrames = 10)
        assertFailsWith<IllegalArgumentException> { TransitionTimeline(scope.items) }
    }

    @Test
    fun `consecutive transitions are rejected`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 10)
        scope.Wipe(durationInFrames = 10)
        scope.Scene(40) { }
        assertFailsWith<IllegalArgumentException> { TransitionTimeline(scope.items) }
    }

    @Test
    fun `transition longer than previous scene is rejected`() {
        val scope = TransitionScope()
        scope.Scene(10) { }
        scope.Fade(durationInFrames = 20)
        scope.Scene(40) { }
        assertFailsWith<IllegalArgumentException> { TransitionTimeline(scope.items) }
    }

    @Test
    fun `transition longer than following scene is rejected`() {
        val scope = TransitionScope()
        scope.Scene(40) { }
        scope.Fade(durationInFrames = 20)
        scope.Scene(10) { }
        assertFailsWith<IllegalArgumentException> { TransitionTimeline(scope.items) }
    }

    // --- transitionProgress -------------------------------------------------

    @Test
    fun `progress is 0 at the overlap start frame`() {
        // A non-linear easing must still report 0 at the very start frame.
        val quadratic = Easing { t -> t * t }
        assertEquals(0f, transitionProgress(30, 30, 10, quadratic))
    }

    @Test
    fun `progress is half at the overlap middle frame with linear easing`() {
        assertEquals(0.5f, transitionProgress(35, 30, 10, LinearEasing))
    }

    @Test
    fun `progress at the overlap end frame is one frame short of 1`() {
        assertEquals(0.9f, transitionProgress(39, 30, 10, LinearEasing))
    }

    @Test
    fun `progress before the overlap start is 0`() {
        assertEquals(0f, transitionProgress(29, 30, 10, LinearEasing))
    }

    @Test
    fun `progress at and after the overlap end is 1`() {
        assertEquals(1f, transitionProgress(40, 30, 10, LinearEasing))
        assertEquals(1f, transitionProgress(41, 30, 10, LinearEasing))
    }

    @Test
    fun `progress is shaped by the easing`() {
        val quadratic = Easing { t -> t * t }
        assertEquals(0.25f, transitionProgress(35, 30, 10, quadratic))
        assertEquals(0.9f * 0.9f, transitionProgress(39, 30, 10, quadratic))
    }

    // --- Transition.frame ---------------------------------------------------

    @Test
    fun `fade frame at start middle and end of overlap`() {
        val t = FadeTransition(10)
        val start = t.frame(0f)
        assertEquals(1f, start.outgoingAlpha)
        assertEquals(0f, start.incomingAlpha)
        val mid = t.frame(0.5f)
        assertEquals(0.5f, mid.outgoingAlpha)
        assertEquals(0.5f, mid.incomingAlpha)
        val end = t.frame(0.9f)
        assertEquals(1f - 0.9f, end.outgoingAlpha)
        assertEquals(0.9f, end.incomingAlpha)
    }

    @Test
    fun `slide frame at start middle and end of overlap`() {
        val t = SlideTransition(10)
        val start = t.frame(0f)
        assertEquals(OffsetFraction(0f, 0f), start.outgoingOffset)
        assertEquals(OffsetFraction(1f, 0f), start.incomingOffset)
        val mid = t.frame(0.5f)
        assertEquals(OffsetFraction(-0.5f, 0f), mid.outgoingOffset)
        assertEquals(OffsetFraction(0.5f, 0f), mid.incomingOffset)
        val end = t.frame(0.9f)
        assertEquals(OffsetFraction(-0.9f, 0f), end.outgoingOffset)
        assertEquals(OffsetFraction(1f - 0.9f, 0f), end.incomingOffset)
    }

    @Test
    fun `slide frame vertical direction`() {
        val t = SlideTransition(10, direction = TransitionDirection.TopToBottom)
        val mid = t.frame(0.5f)
        assertEquals(OffsetFraction(0f, -0.5f), mid.outgoingOffset)
        assertEquals(OffsetFraction(0f, 0.5f), mid.incomingOffset)
    }

    @Test
    fun `wipe frame at start middle and end of overlap`() {
        val t = WipeTransition(10)
        assertEquals(Clip.RectClip(0f, 0f, 0f, 1f), t.frame(0f).clip)
        assertEquals(Clip.RectClip(0f, 0f, 0.5f, 1f), t.frame(0.5f).clip)
        assertEquals(Clip.RectClip(0f, 0f, 0.9f, 1f), t.frame(0.9f).clip)
    }

    @Test
    fun `wipe frame right to left and bottom to top`() {
        val rtl = WipeTransition(10, direction = TransitionDirection.RightToLeft)
        assertEquals(Clip.RectClip(0.5f, 0f, 1f, 1f), rtl.frame(0.5f).clip)
        val btt = WipeTransition(10, direction = TransitionDirection.BottomToTop)
        assertEquals(Clip.RectClip(0f, 0.5f, 1f, 1f), btt.frame(0.5f).clip)
    }

    @Test
    fun `iris frame at start middle and end of overlap`() {
        val t = IrisTransition(10)
        assertEquals(Clip.IrisClip(0f), t.frame(0f).clip)
        assertEquals(Clip.IrisClip(0.5f), t.frame(0.5f).clip)
        assertEquals(Clip.IrisClip(0.9f), t.frame(0.9f).clip)
    }

    @Test
    fun `clock wipe frame at start middle and end of overlap`() {
        val t = ClockWipeTransition(10)
        assertEquals(Clip.ClockWipeClip(0f, -90f, true), t.frame(0f).clip)
        assertEquals(Clip.ClockWipeClip(0.5f, -90f, true), t.frame(0.5f).clip)
        assertEquals(Clip.ClockWipeClip(0.9f, -90f, true), t.frame(0.9f).clip)
    }

    @Test
    fun `each transition type is distinct at the middle frame`() {
        val frames = listOf(
            FadeTransition(10).frame(0.5f),
            SlideTransition(10).frame(0.5f),
            WipeTransition(10).frame(0.5f),
            IrisTransition(10).frame(0.5f),
            ClockWipeTransition(10).frame(0.5f),
        )
        for (i in frames.indices) {
            for (j in i + 1 until frames.size) {
                assertTrue(frames[i] != frames[j], "frames $i and $j should differ")
            }
        }
    }
}
