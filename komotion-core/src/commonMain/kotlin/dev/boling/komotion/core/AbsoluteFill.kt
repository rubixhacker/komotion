package dev.boling.komotion.core

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Fills the parent's available space and lays out [content] to fill it, for
 * Remotion-style overlay behavior.
 *
 * [Sequence] adds no layout wrapper by default; use [AbsoluteFill] when content
 * should fill (overlay) the parent's space, for example an intro that covers
 * the whole composition while the rest of the timeline continues beneath it.
 */
@Composable
fun AbsoluteFill(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(modifier = modifier.fillMaxSize()) {
        content()
    }
}
