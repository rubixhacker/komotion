package dev.boling.komotion.theme

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals

class KomotionColorsTest {
    @Test
    fun `default colors match spec values`() {
        val colors = KomotionColors()
        assertEquals(Color(0xFF0D0F14), colors.background)
        assertEquals(Color(0xFF1A1D26), colors.surface)
        assertEquals(Color(0xFF00FFA3), colors.accent)
        assertEquals(Color(0xFF7B61FF), colors.accent2)
        assertEquals(Color(0xFFE8EAF0), colors.text)
        assertEquals(Color(0xFF6B7280), colors.muted)
        assertEquals(Color(0xFFFF6B6B), colors.error)
    }

    @Test
    fun `custom colors override defaults`() {
        val custom = KomotionColors(accent = Color.Red)
        assertEquals(Color.Red, custom.accent)
        assertEquals(Color(0xFF0D0F14), custom.background)
    }
}
