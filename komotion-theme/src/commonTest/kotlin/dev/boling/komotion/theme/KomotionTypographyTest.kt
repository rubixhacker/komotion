package dev.boling.komotion.theme

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import kotlin.test.Test
import kotlin.test.assertEquals

class KomotionTypographyTest {
    @Test
    fun `default typography uses Monospace`() {
        val typo = KomotionTypography()
        assertEquals(FontFamily.Monospace, typo.fontFamily)
    }

    @Test
    fun `default font sizes match spec`() {
        val typo = KomotionTypography()
        assertEquals(48.sp, typo.display.fontSize)
        assertEquals(24.sp, typo.title.fontSize)
        assertEquals(16.sp, typo.body.fontSize)
        assertEquals(12.sp, typo.label.fontSize)
        assertEquals(14.sp, typo.code.fontSize)
    }

    @Test
    fun `code style always uses Monospace`() {
        val typo = KomotionTypography()
        assertEquals(FontFamily.Monospace, typo.code.fontFamily)
    }
}
