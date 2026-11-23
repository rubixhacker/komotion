package dev.boling.komotion.core

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.createFontFamilyResolver
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class, ExperimentalKomotionApi::class)
class KomotionFontTest {

    private val testFont = FontAsset(testFontFile().absolutePath)

    @Test
    fun `provides the font family to the subtree`() = runComposeUiTest {
        var observed: FontFamily? = null
        setContent {
            KomotionFont(testFont) {
                observed = LocalFontFamily.current
            }
        }
        assertNotNull(observed)
        assertTrue(observed !== FontFamily.Default)
        val fonts = assertIs<FontListFontFamily>(observed).fonts
        assertEquals(1, fonts.size)
    }

    @Test
    fun `defaults to the system font family outside KomotionFont`() = runComposeUiTest {
        var observed: FontFamily? = null
        setContent {
            observed = LocalFontFamily.current
        }
        assertEquals(FontFamily.Default, observed)
    }

    @Test
    fun `the provided font family resolves to a typeface`() {
        val resolver = createFontFamilyResolver()
        val state = resolver.resolve(testFont.toFontFamily())
        assertNotNull(state.value)
    }

    @Test
    fun `a nested KomotionFont provides its own family`() = runComposeUiTest {
        var inner: FontFamily? = null
        var outer: FontFamily? = null
        setContent {
            KomotionFont(testFont) {
                outer = LocalFontFamily.current
                KomotionFont(testFont) {
                    inner = LocalFontFamily.current
                }
            }
        }
        assertNotNull(outer)
        assertNotNull(inner)
        assertEquals(outer, inner)
    }

    private fun testFontFile(): File {
        val url = javaClass.classLoader.getResource("test-font.ttf")
            ?: error("test-font.ttf not found on the test classpath")
        return File(url.toURI())
    }
}
