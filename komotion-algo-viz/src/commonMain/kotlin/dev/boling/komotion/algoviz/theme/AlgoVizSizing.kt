package dev.boling.komotion.algoviz.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.boling.komotion.theme.KomotionTheme

data class AlgoVizSizing(
    val cellSize: Dp = 56.dp,
    val cellBorderWidth: Dp = 2.dp,
    val nodeRadius: Dp = 22.dp,
    val nodeStrokeWidth: Dp = 2.dp,
    val eliminatedOpacity: Float = 0.2f,
)

val LocalAlgoVizSizing = compositionLocalOf { AlgoVizSizing() }

val KomotionTheme.algoViz: AlgoVizSizing
    @Composable get() = LocalAlgoVizSizing.current
