package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.layout.Layout

/**
 * A time-windowed container. Children are only composed when [LocalFrame] is within
 * [from] until [from] + [durationInFrames]. Within that window, [LocalFrame] is offset
 * so children see 0 at [from].
 *
 * Outside the window, emits a zero-size Layout so no space is reserved in the parent.
 */
@Composable
fun Sequence(
    from: Int,
    durationInFrames: Int,
    content: @Composable () -> Unit,
) {
    val globalFrame = LocalFrame.current
    if (globalFrame !in from until from + durationInFrames) {
        // Emit nothing — zero-size layout so parent reserves no space.
        Layout(content = {}) { _, _ -> layout(0, 0) {} }
        return
    }
    val localFrame = globalFrame - from
    CompositionLocalProvider(LocalFrame provides localFrame) {
        content()
    }
}
