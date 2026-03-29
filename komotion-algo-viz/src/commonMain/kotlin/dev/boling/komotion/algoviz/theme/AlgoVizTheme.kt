package dev.boling.komotion.algoviz.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

data class AlgoVizTheme(
    val background: Color = Color(0xFF0D0F14),
    val surface: Color = Color(0xFF1A1D26),
    val accent: Color = Color(0xFF00FFA3),
    val accent2: Color = Color(0xFF7B61FF),
    val text: Color = Color(0xFFE8EAF0),
    val muted: Color = Color(0xFF6B7280),
    val fontFamily: FontFamily = FontFamily.Monospace,
    val cellSize: Dp = 56.dp,
    val cellCornerRadius: Dp = 8.dp,
    val cellBorderWidth: Dp = 2.dp,
    val nodeRadius: Dp = 22.dp,
    val nodeStrokeWidth: Dp = 2.dp,
    val eliminatedOpacity: Float = 0.2f,
)

val LocalAlgoVizTheme = compositionLocalOf { AlgoVizTheme() }

@Composable
fun AlgoVizThemeProvider(
    theme: AlgoVizTheme = AlgoVizTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalAlgoVizTheme provides theme) {
        content()
    }
}
