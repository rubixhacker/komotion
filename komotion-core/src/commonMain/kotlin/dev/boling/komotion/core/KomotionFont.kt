package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily

/**
 * The [FontFamily] provided by the nearest enclosing [komotionFont], or
 * [FontFamily.Default] when the content is not inside a [komotionFont].
 */
val LocalFontFamily: ProvidableCompositionLocal<FontFamily> = staticCompositionLocalOf { FontFamily.Default }

/**
 * Provides the [FontFamily] built from [asset] to the subtree.
 *
 * Children read [LocalFontFamily] and pass it to their text:
 *
 * ```
 * komotionFont(asset) {
 *     Text("Hello", fontFamily = LocalFontFamily.current)
 * }
 * ```
 */
@ExperimentalKomotionApi
@Composable
fun komotionFont(
    asset: FontAsset,
    content: @Composable () -> Unit,
) {
    val fontFamily = remember(asset) { asset.toFontFamily() }
    CompositionLocalProvider(LocalFontFamily.provides(fontFamily)) {
        content()
    }
}
