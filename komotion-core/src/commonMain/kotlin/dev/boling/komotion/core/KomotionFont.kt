package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily

/**
 * The [FontFamily] provided by the nearest enclosing [KomotionFont], or
 * [FontFamily.Default] when the content is not inside a [KomotionFont].
 */
val LocalFontFamily: ProvidableCompositionLocal<FontFamily> = staticCompositionLocalOf { FontFamily.Default }

/**
 * Provides the [FontFamily] built from [asset] to the subtree.
 *
 * Children read [LocalFontFamily] and pass it to their text:
 *
 * ```
 * KomotionFont(asset) {
 *     Text("Hello", fontFamily = LocalFontFamily.current)
 * }
 * ```
 */
@ExperimentalKomotionApi
@Composable
fun KomotionFont(
    asset: FontAsset,
    content: @Composable () -> Unit,
) {
    val fontFamily = remember(asset) { asset.toFontFamily() }
    CompositionLocalProvider(LocalFontFamily.provides(fontFamily)) {
        content()
    }
}
