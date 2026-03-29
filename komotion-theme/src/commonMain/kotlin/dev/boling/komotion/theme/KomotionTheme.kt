package dev.boling.komotion.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf

internal val LocalKomotionColors = compositionLocalOf { KomotionColors() }
internal val LocalKomotionShapes = compositionLocalOf { KomotionShapes() }
internal val LocalKomotionTypography = compositionLocalOf { KomotionTypography() }

object KomotionTheme {
    val colors: KomotionColors
        @Composable get() = LocalKomotionColors.current
    val shapes: KomotionShapes
        @Composable get() = LocalKomotionShapes.current
    val typography: KomotionTypography
        @Composable get() = LocalKomotionTypography.current
}

@Composable
fun KomotionTheme(
    colors: KomotionColors = KomotionColors(),
    shapes: KomotionShapes = KomotionShapes(),
    typography: KomotionTypography = KomotionTypography(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalKomotionColors provides colors,
        LocalKomotionShapes provides shapes,
        LocalKomotionTypography provides typography,
    ) {
        content()
    }
}
