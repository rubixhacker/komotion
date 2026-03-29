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

/**
 * Renders an array as a horizontal row of cells with optional
 * pointer markers, highlight states, partitions, and swap animation.
 */
@Composable
fun ArrayViz(
    state: ArrayVizState,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier,
    ) {
        // Pointers above
        Row(horizontalArrangement = Arrangement.Center) {
            state.elements.forEachIndexed { index, _ ->
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(theme.cellSize, 28.dp),
                ) {
                    val pointer = state.pointers.find {
                        it.index == index && it.position == PointerPosition.Above
                    }
                    if (pointer != null) {
                        PointerMarker(
                            label = pointer.label,
                            position = PointerPosition.Above,
                            color = pointer.color,
                        )
                    }
                }
                if (index < state.elements.lastIndex) {
                    Spacer(Modifier.width(4.dp))
                }
            }
        }

        // Array cells
        Row(horizontalArrangement = Arrangement.Center) {
            state.elements.forEachIndexed { index, value ->
                val highlight = state.highlights[index] ?: HighlightState.Default
                val cellColors = resolveCellColors(highlight, theme)

                // Swap offset: Dp * Int and Dp * Float are both supported in Compose
                val offsetX = if (state.swappingIndices != null) {
                    val (a, b) = state.swappingIndices
                    val distance = (theme.cellSize + 4.dp) * kotlin.math.abs(b - a)
                    when (index) {
                        a -> distance * state.swapProgress
                        b -> -distance * state.swapProgress
                        else -> 0.dp
                    }
                } else {
                    0.dp
                }

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(theme.cellSize)
                        .offset(x = offsetX)
                        .graphicsLayer {
                            alpha = if (highlight == HighlightState.Eliminated) {
                                theme.eliminatedOpacity
                            } else {
                                1f
                            }
                        }
                        .background(
                            cellColors.background,
                            RoundedCornerShape(theme.cellCornerRadius),
                        )
                        .border(
                            theme.cellBorderWidth,
                            cellColors.border,
                            RoundedCornerShape(theme.cellCornerRadius),
                        ),
                ) {
                    BasicText(
                        text = value,
                        style = TextStyle(
                            color = cellColors.text,
                            fontSize = 18.sp,
                            fontFamily = theme.fontFamily,
                            textAlign = TextAlign.Center,
                        ),
                    )
                }
                if (index < state.elements.lastIndex) {
                    Spacer(Modifier.width(4.dp))
                }
            }
        }

        // Pointers below
        Row(horizontalArrangement = Arrangement.Center) {
            state.elements.forEachIndexed { index, _ ->
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(theme.cellSize, 28.dp),
                ) {
                    val pointer = state.pointers.find {
                        it.index == index && it.position == PointerPosition.Below
                    }
                    if (pointer != null) {
                        PointerMarker(
                            label = pointer.label,
                            position = PointerPosition.Below,
                            color = pointer.color,
                        )
                    }
                }
                if (index < state.elements.lastIndex) {
                    Spacer(Modifier.width(4.dp))
                }
            }
        }
    }
}

private data class CellColors(
    val background: Color,
    val border: Color,
    val text: Color,
)

private fun resolveCellColors(
    highlight: HighlightState,
    theme: dev.boling.komotion.algoviz.theme.AlgoVizTheme,
): CellColors = when (highlight) {
    HighlightState.Default -> CellColors(
        background = theme.surface,
        border = theme.muted,
        text = theme.text,
    )
    HighlightState.Active -> CellColors(
        background = theme.accent.copy(alpha = 0.15f),
        border = theme.accent,
        text = theme.accent,
    )
    HighlightState.Comparing -> CellColors(
        background = theme.accent2.copy(alpha = 0.15f),
        border = theme.accent2,
        text = theme.accent2,
    )
    HighlightState.Found -> CellColors(
        background = theme.accent.copy(alpha = 0.3f),
        border = theme.accent,
        text = theme.text,
    )
    HighlightState.Eliminated -> CellColors(
        background = theme.surface,
        border = theme.muted,
        text = theme.muted,
    )
}
