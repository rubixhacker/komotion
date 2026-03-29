package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
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
import dev.boling.komotion.algoviz.theme.LocalAlgoVizSizing
import dev.boling.komotion.theme.KomotionColors
import dev.boling.komotion.theme.KomotionTheme

@Composable
fun StackQueueViz(
    state: StackQueueVizState,
    modifier: Modifier = Modifier,
) {
    val sizing = LocalAlgoVizSizing.current
    val shapes = KomotionTheme.shapes

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
                            translationY = -sizing.cellSize.toPx() * (1f - state.pushProgress)
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
                                translationY = -sizing.cellSize.toPx() * state.popProgress
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
                                translationX = -sizing.cellSize.toPx() * state.popProgress
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
                            translationX = sizing.cellSize.toPx() * (1f - state.pushProgress)
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
    val colors = KomotionTheme.colors
    val sizing = LocalAlgoVizSizing.current
    val typography = KomotionTheme.typography
    val shapes = KomotionTheme.shapes
    val cellColors = resolveSQCellColors(highlight, colors)

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(sizing.cellSize)
            .graphicsLayer {
                alpha = if (highlight == HighlightState.Eliminated) {
                    sizing.eliminatedOpacity
                } else {
                    1f
                }
            }
            .background(cellColors.background, shapes.medium)
            .border(sizing.cellBorderWidth, cellColors.border, shapes.medium),
    ) {
        BasicText(
            text = value,
            style = TextStyle(
                color = cellColors.text,
                fontSize = 18.sp,
                fontFamily = typography.fontFamily,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

private data class SQCellColors(val background: Color, val border: Color, val text: Color)

private fun resolveSQCellColors(
    highlight: HighlightState,
    colors: KomotionColors,
): SQCellColors = when (highlight) {
    HighlightState.Default -> SQCellColors(colors.surface, colors.muted, colors.text)
    HighlightState.Active -> SQCellColors(colors.accent.copy(alpha = 0.15f), colors.accent, colors.accent)
    HighlightState.Comparing -> SQCellColors(colors.accent2.copy(alpha = 0.15f), colors.accent2, colors.accent2)
    HighlightState.Found -> SQCellColors(colors.accent.copy(alpha = 0.3f), colors.accent, colors.text)
    HighlightState.Eliminated -> SQCellColors(colors.surface, colors.muted, colors.muted)
}
