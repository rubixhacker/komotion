package dev.boling.komotion.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.LocalComposition
import dev.boling.komotion.core.LocalFrame
import dev.boling.komotion.media.AudioMedia
import dev.boling.komotion.media.LocalMediaCollector
import dev.boling.komotion.media.MediaCollector
import dev.boling.komotion.player.internal.PreviewAudioController
import kotlinx.coroutines.delay
import kotlin.time.TimeSource
import kotlin.time.Duration.Companion.milliseconds

/**
 * Embeds an animated composition with transport controls.
 *
 * The [content] composable reads [LocalFrame] to drive its animation.
 * [KomotionPlayer] injects [LocalFrame], [LocalComposition] and
 * [LocalMediaCollector] before calling [content], so media declared in
 * [content] is collected for preview and export alike.
 *
 * Declared [AudioMedia] is previewed while the player plays: it stops on
 * pause and at the end, follows seeks, and is subject to [audioVolume] and
 * [audioMuted] in addition to each declaration's own volume and mute.
 * Preview audio is independent of [dev.boling.komotion.core.FrameRenderer]
 * export, which mixes the same declarations via FFmpeg.
 *
 * @param audioVolume Player-level volume multiplier (0..1) applied on top of
 * each declaration's own volume.
 * @param audioMuted Player-level mute applied on top of each declaration's
 * own mute.
 */
@Composable
fun KomotionPlayer(
    composition: Composition,
    modifier: Modifier = Modifier,
    initialFrame: Int = 0,
    loop: Boolean = true,
    autoPlay: Boolean = false,
    mediaCollector: MediaCollector = remember { MediaCollector() },
    audioVolume: Float = 1f,
    audioMuted: Boolean = false,
    content: @Composable () -> Unit,
) {
    var currentFrame by remember { mutableStateOf(initialFrame) }
    var isPlaying by remember { mutableStateOf(autoPlay) }
    var loopEnabled by remember { mutableStateOf(loop) }

    // Preview audio: one controller drives the platform players for every
    // declared audio. Disposed when the player leaves the composition.
    val audioController = remember { PreviewAudioController() }
    DisposableEffect(Unit) {
        onDispose { audioController.dispose() }
    }

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

    // Keep the preview audio in sync with the current frame and playback
    // state. The collector's snapshot is read after composition, so it
    // reflects the declarations registered at the current frame.
    LaunchedEffect(currentFrame, isPlaying, audioVolume, audioMuted) {
        val declarations = mediaCollector.snapshot().filterIsInstance<AudioMedia>()
        audioController.sync(
            declarations = declarations,
            frame = currentFrame,
            fps = composition.fps,
            playing = isPlaying,
            playerVolume = audioVolume,
            playerMuted = audioMuted,
        )
    }

    mediaCollector.frame = currentFrame
    CompositionLocalProvider(
        LocalFrame provides currentFrame,
        LocalComposition provides composition,
        LocalMediaCollector provides mediaCollector,
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
