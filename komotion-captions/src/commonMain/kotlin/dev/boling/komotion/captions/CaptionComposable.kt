package dev.boling.komotion.captions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import dev.boling.komotion.core.currentFrame
import dev.boling.komotion.theme.KomotionTheme

/**
 * Renders the caption cue active at the current frame, driven by
 * [dev.boling.komotion.core.LocalFrame].
 *
 * If no cue covers the current frame, nothing is rendered. If several cues
 * overlap, the first one in [captions] wins.
 *
 * The default content renders the cue's text with styling defaults from
 * [KomotionTheme]: the [dev.boling.komotion.theme.KomotionColors.text] color,
 * the [dev.boling.komotion.theme.KomotionColors.surface] background, the
 * [dev.boling.komotion.theme.KomotionShapes.medium] corner shape and the
 * [dev.boling.komotion.theme.KomotionTypography.body] text style. Pass [content]
 * to render the active [Caption] yourself.
 */
@Composable
fun Caption(
    captions: List<Caption>,
    modifier: Modifier = Modifier,
    style: TextStyle? = null,
    color: Color? = null,
    backgroundColor: Color? = null,
    content: @Composable (Caption) -> Unit = { cue ->
        CaptionText(cue, modifier, style, color, backgroundColor)
    },
) {
    val active = activeCaptionAt(captions, currentFrame()) ?: return
    content(active)
}

@Composable
private fun CaptionText(
    cue: Caption,
    modifier: Modifier,
    style: TextStyle?,
    color: Color?,
    backgroundColor: Color?,
) {
    val colors = KomotionTheme.colors
    val shapes = KomotionTheme.shapes
    val typography = KomotionTheme.typography
    Text(
        text = cue.text,
        modifier = modifier
            .background(color = backgroundColor ?: colors.surface, shape = shapes.medium)
            .padding(8.dp),
        style = style ?: typography.body,
        color = color ?: colors.text,
    )
}
