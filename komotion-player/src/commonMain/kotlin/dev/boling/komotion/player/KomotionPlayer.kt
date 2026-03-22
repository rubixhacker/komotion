package dev.boling.komotion.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.LocalComposition
import dev.boling.komotion.core.LocalFrame
import kotlinx.coroutines.delay
import kotlin.time.TimeSource
import kotlin.time.Duration.Companion.milliseconds

/**
 * Embeds an animated composition with transport controls.
 *
 * The [content] composable reads [LocalFrame] to drive its animation.
 * [KomotionPlayer] injects both [LocalFrame] and [LocalComposition] before calling [content].
 */
@Composable
fun KomotionPlayer(
    composition: Composition,
    modifier: Modifier = Modifier,
    initialFrame: Int = 0,
    loop: Boolean = true,
    autoPlay: Boolean = false,
    content: @Composable () -> Unit,
) {
    var currentFrame by remember { mutableStateOf(initialFrame) }
    var isPlaying by remember { mutableStateOf(autoPlay) }
    var loopEnabled by remember { mutableStateOf(loop) }

    // Wall-clock corrected playback using TimeSource.Monotonic (commonMain safe).
    // mark is recalculated on each play/resume to account for the current frame.
    var mark by remember { mutableStateOf(TimeSource.Monotonic.markNow()) }

    fun startPlayback() {
        val frameOffsetMs = currentFrame * 1000L / composition.fps
        mark = TimeSource.Monotonic.markNow() - frameOffsetMs.milliseconds
        isPlaying = true
    }

    LaunchedEffect(isPlaying, mark) {
        if (!isPlaying) return@LaunchedEffect
        while (isPlaying) {
            val elapsed = mark.elapsedNow()
            val targetFrame = (elapsed.inWholeMilliseconds * composition.fps / 1000).toInt()
            val nextFrame = if (loopEnabled) {
                targetFrame % composition.durationInFrames
            } else {
                targetFrame.coerceAtMost(composition.durationInFrames - 1)
            }
            currentFrame = nextFrame
            if (!loopEnabled && nextFrame == composition.durationInFrames - 1) {
                isPlaying = false
                break
            }
            delay(1)
        }
    }

    CompositionLocalProvider(
        LocalFrame provides currentFrame,
        LocalComposition provides composition,
    ) {
        Column(modifier = modifier) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.Black)
            ) {
                content()
            }
            PlayerControls(
                currentFrame = currentFrame,
                totalFrames = composition.durationInFrames,
                isPlaying = isPlaying,
                loop = loopEnabled,
                onPlayPause = {
                    if (isPlaying) {
                        isPlaying = false
                    } else {
                        startPlayback()
                    }
                },
                onSkipToStart = {
                    isPlaying = false
                    currentFrame = 0
                },
                onSkipToEnd = {
                    isPlaying = false
                    currentFrame = composition.durationInFrames - 1
                },
                onScrub = { frame ->
                    isPlaying = false
                    currentFrame = frame
                },
                onLoopToggle = { loopEnabled = !loopEnabled },
            )
        }
    }
}
