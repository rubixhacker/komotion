package dev.boling.komotion.player

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import dev.boling.komotion.core.Composition
import dev.boling.komotion.core.CompositionEntry
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
 *
 * Pass a [controller] to drive the player programmatically and observe its
 * state and events from outside the composition.
 *
 * Playback is restricted to the frame window [inFrame]..[outFrame] (default:
 * the whole composition) and scaled by [playbackRate]. Set [controls] to
 * false to hide the control bar and disable the keyboard shortcuts.
 */
@Composable
fun KomotionPlayer(
    composition: Composition,
    controller: KomotionPlayerController? = null,
    modifier: Modifier = Modifier,
    initialFrame: Int = 0,
    inFrame: Int? = null,
    outFrame: Int? = null,
    loop: Boolean = true,
    autoPlay: Boolean = false,
    playbackRate: Float = 1f,
    volume: Float = 1f,
    muted: Boolean = false,
    controls: Boolean = true,
    content: @Composable () -> Unit,
) {
    require(composition.durationInFrames > 0) { "composition.durationInFrames must be positive" }
    require(playbackRate > 0f) { "playbackRate must be positive" }

    val lastFrame = composition.durationInFrames - 1
    val windowStart = inFrame?.coerceIn(0, lastFrame) ?: 0
    val windowEnd = outFrame?.coerceIn(windowStart, lastFrame) ?: lastFrame

    var currentFrame by remember { mutableStateOf(initialFrame.coerceIn(windowStart, windowEnd)) }
    var isPlaying by remember { mutableStateOf(false) }
    var loopEnabled by remember { mutableStateOf(loop) }
    var playerVolume by remember { mutableStateOf(volume.coerceIn(0f, 1f)) }
    var muted by remember { mutableStateOf(muted) }
    var fullscreen by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Wall-clock corrected playback using TimeSource.Monotonic (commonMain safe).
    // mark is recalculated on each play/resume to account for the current frame.
    var mark by remember { mutableStateOf(TimeSource.Monotonic.markNow()) }

    fun emit(event: KomotionPlayerEvent) {
        val c = controller ?: return
        c._events.tryEmit(event)
    }

    fun startPlayback() {
        val framesIntoWindow = maxOf(0, currentFrame - windowStart)
        val frameOffsetMs = (framesIntoWindow * 1000.0 / (composition.fps * playbackRate)).toLong()
        mark = TimeSource.Monotonic.markNow() - frameOffsetMs.milliseconds
        if (!isPlaying) {
            isPlaying = true
            emit(KomotionPlayerEvent.Play)
        }
    }

    fun pausePlayback() {
        if (isPlaying) {
            isPlaying = false
            emit(KomotionPlayerEvent.Pause)
        }
    }

    fun togglePlayback() {
        if (isPlaying) pausePlayback() else startPlayback()
    }

    fun toggleMute() {
        muted = !muted
    }

    fun toggleLoop() {
        loopEnabled = !loopEnabled
    }

    fun seek(frame: Int) {
        if (frame < 0 || frame >= composition.durationInFrames) {
            val message = "Seek to frame $frame is outside the composition (0..$lastFrame)"
            error = message
            emit(KomotionPlayerEvent.Error(message))
            return
        }
        isPlaying = false
        currentFrame = frame.coerceIn(windowStart, windowEnd)
        emit(KomotionPlayerEvent.Seeked)
        emit(KomotionPlayerEvent.FrameUpdate(currentFrame))
    }

    LaunchedEffect(Unit) {
        if (autoPlay) startPlayback()
    }

    // Wall-clock playback loop.
    LaunchedEffect(isPlaying, mark) {
        if (!isPlaying) return@LaunchedEffect
        while (isPlaying) {
            val elapsed = mark.elapsedNow()
            val frame = targetFrame(
                elapsed.inWholeMilliseconds,
                composition.fps,
                playbackRate,
                windowStart,
                windowEnd,
                loopEnabled,
            )
            if (frame != currentFrame) {
                currentFrame = frame
                emit(KomotionPlayerEvent.FrameUpdate(frame))
            }
            if (!loopEnabled && frame == windowEnd) {
                isPlaying = false
                emit(KomotionPlayerEvent.Ended)
                break
            }
            delay(1)
        }
    }

    // Publish the player's state to the controller whenever it changes.
    if (controller != null) {
        LaunchedEffect(controller) {
            snapshotFlow {
                KomotionPlayerState(
                    frame = currentFrame,
                    isPlaying = isPlaying,
                    loop = loopEnabled,
                    playbackRate = playbackRate,
                    volume = playerVolume,
                    muted = muted,
                    fullscreen = fullscreen,
                    error = error,
                )
            }.collect { controller._state.value = it }
        }

        // Apply commands from the controller.
        LaunchedEffect(controller) {
            controller.commands.collect { command ->
                when (command) {
                    KomotionPlayerCommand.Play -> startPlayback()
                    KomotionPlayerCommand.Pause -> pausePlayback()
                    KomotionPlayerCommand.Toggle -> togglePlayback()
                    is KomotionPlayerCommand.SeekTo -> seek(command.frame)
                    is KomotionPlayerCommand.SetVolume -> playerVolume = command.volume.coerceIn(0f, 1f)
                    KomotionPlayerCommand.Mute -> toggleMute()
                    KomotionPlayerCommand.RequestFullscreen -> fullscreen = true
                }
            }
        }
    }

    // Platform fullscreen, driven by the player's fullscreen state.
    val platformFullscreen = rememberPlatformFullscreen()
    LaunchedEffect(fullscreen) {
        if (fullscreen) platformFullscreen.enter() else platformFullscreen.exit()
    }

    val keyboardModifier = if (controls) {
        Modifier.onPreviewKeyEvent { keyEvent ->
            when (keyEvent.key) {
                Key.Spacebar -> {
                    togglePlayback()
                    true
                }
                Key.DirectionLeft -> {
                    seek(maxOf(windowStart, currentFrame - 1))
                    true
                }
                Key.DirectionRight -> {
                    seek(minOf(windowEnd, currentFrame + 1))
                    true
                }
                Key.DirectionUp -> {
                    playerVolume = (playerVolume + 0.1f).coerceAtMost(1f)
                    true
                }
                Key.DirectionDown -> {
                    playerVolume = (playerVolume - 0.1f).coerceAtLeast(0f)
                    true
                }
                Key.M -> {
                    toggleMute()
                    true
                }
                Key.L -> {
                    toggleLoop()
                    true
                }
                Key.F -> {
                    fullscreen = !fullscreen
                    true
                }
                else -> false
            }
        }
    } else {
        Modifier
    }

    CompositionLocalProvider(
        LocalFrame provides currentFrame,
        LocalComposition provides composition,
    ) {
        Column(
            modifier = modifier
                .then(keyboardModifier)
                .then(if (controls) Modifier.focusable() else Modifier),
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.Black)
            ) {
                content()
            }
            if (controls) {
                PlayerControls(
                    currentFrame = currentFrame,
                    windowStart = windowStart,
                    windowEnd = windowEnd,
                    isPlaying = isPlaying,
                    loop = loopEnabled,
                    fullscreen = fullscreen,
                    onPlayPause = { togglePlayback() },
                    onSkipToStart = { seek(windowStart) },
                    onSkipToEnd = { seek(windowEnd) },
                    onScrub = { seek(it) },
                    onLoopToggle = { toggleLoop() },
                    onFullscreenToggle = { fullscreen = !fullscreen },
                )
            }
        }
    }
}

/**
 * Embeds a registered [CompositionEntry] with transport controls.
 *
 * The entry's [CompositionEntry.content] receives [props] (or the entry's
 * default props when [props] is null), in place of a raw content block.
 */
@Composable
fun <P : Any> KomotionPlayer(
    entry: CompositionEntry<P>,
    controller: KomotionPlayerController? = null,
    modifier: Modifier = Modifier,
    props: P? = null,
    initialFrame: Int = 0,
    inFrame: Int? = null,
    outFrame: Int? = null,
    loop: Boolean = true,
    autoPlay: Boolean = false,
    playbackRate: Float = 1f,
    volume: Float = 1f,
    muted: Boolean = false,
    controls: Boolean = true,
) {
    KomotionPlayer(
        composition = entry.composition,
        controller = controller,
        modifier = modifier,
        initialFrame = initialFrame,
        inFrame = inFrame,
        outFrame = outFrame,
        loop = loop,
        autoPlay = autoPlay,
        playbackRate = playbackRate,
        volume = volume,
        muted = muted,
        controls = controls,
    ) {
        entry.content(entry.resolveProps(props))
    }
}
