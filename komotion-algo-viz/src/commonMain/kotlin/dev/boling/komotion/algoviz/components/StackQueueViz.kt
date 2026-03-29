package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.boling.komotion.algoviz.state.*
import dev.boling.komotion.algoviz.theme.LocalAlgoVizTheme

@Composable
fun StackQueueViz(
    state: StackQueueVizState,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current

    when (state.mode) {
        StackQueueMode.Stack -> {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = modifier,
            ) {
                if (state.pushingElement != null) {
                    StackQueueCell(
                        value = state.pushingElement,
                        highlight = HighlightState.Active,
                        modifier = Modifier.graphicsLayer {
                            alpha = state.pushProgress
                            translationY = -theme.cellSize.toPx() * (1f - state.pushProgress)
                        },
                    )
                    Spacer(Modifier.height(4.dp))
                }

                state.elements.forEachIndexed { index, value ->
                    val highlight = state.highlights[index] ?: HighlightState.Default
                    val isPopping = state.poppingIndex == index

                    StackQueueCell(
                        value = value,
                        highlight = highlight,
                        modifier = if (isPopping) {
                            Modifier.graphicsLayer {
                                alpha = 1f - state.popProgress
                                translationY = -theme.cellSize.toPx() * state.popProgress
                            }
                        } else {
                            Modifier
                        },
                    )
                    if (index < state.elements.lastIndex) {
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }

        StackQueueMode.Queue -> {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = modifier,
            ) {
                state.elements.forEachIndexed { index, value ->
                    val highlight = state.highlights[index] ?: HighlightState.Default
                    val isPopping = state.poppingIndex == index

                    StackQueueCell(
                        value = value,
                        highlight = highlight,
                        modifier = if (isPopping) {
                            Modifier.graphicsLayer {
                                alpha = 1f - state.popProgress
                                translationX = -theme.cellSize.toPx() * state.popProgress
                            }
                        } else {
                            Modifier
                        },
                    )
                    if (index < state.elements.lastIndex) {
                        Spacer(Modifier.width(4.dp))
                    }
                }

                if (state.pushingElement != null) {
                    Spacer(Modifier.width(4.dp))
                    StackQueueCell(
                        value = state.pushingElement,
                        highlight = HighlightState.Active,
                        modifier = Modifier.graphicsLayer {
                            alpha = state.pushProgress
                            translationX = theme.cellSize.toPx() * (1f - state.pushProgress)
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun StackQueueCell(
    value: String,
    highlight: HighlightState,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current
    val colors = resolveSQCellColors(highlight, theme)

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(theme.cellSize)
            .graphicsLayer {
                alpha = if (highlight == HighlightState.Eliminated) {
                    theme.eliminatedOpacity
                } else {
                    1f
                }
            }
            .background(colors.background, RoundedCornerShape(theme.cellCornerRadius))
            .border(theme.cellBorderWidth, colors.border, RoundedCornerShape(theme.cellCornerRadius)),
    ) {
        BasicText(
            text = value,
            style = TextStyle(
                color = colors.text,
                fontSize = 18.sp,
                fontFamily = theme.fontFamily,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

private data class SQCellColors(val background: Color, val border: Color, val text: Color)

private fun resolveSQCellColors(
    highlight: HighlightState,
    theme: dev.boling.komotion.algoviz.theme.AlgoVizTheme,
): SQCellColors = when (highlight) {
    HighlightState.Default -> SQCellColors(theme.surface, theme.muted, theme.text)
    HighlightState.Active -> SQCellColors(theme.accent.copy(alpha = 0.15f), theme.accent, theme.accent)
    HighlightState.Comparing -> SQCellColors(theme.accent2.copy(alpha = 0.15f), theme.accent2, theme.accent2)
    HighlightState.Found -> SQCellColors(theme.accent.copy(alpha = 0.3f), theme.accent, theme.text)
    HighlightState.Eliminated -> SQCellColors(theme.surface, theme.muted, theme.muted)
}
