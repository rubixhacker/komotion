package dev.boling.komotion.algoviz.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

class AlgoVizThemeTest {

    @Test
    fun `default theme has correct brand colors`() {
        val theme = AlgoVizTheme()
        assertEquals(Color(0xFF0D0F14), theme.background)
        assertEquals(Color(0xFF1A1D26), theme.surface)
        assertEquals(Color(0xFF00FFA3), theme.accent)
        assertEquals(Color(0xFF7B61FF), theme.accent2)
        assertEquals(Color(0xFFE8EAF0), theme.text)
        assertEquals(Color(0xFF6B7280), theme.muted)
    }

    @Test
    fun `default theme has correct sizes`() {
        val theme = AlgoVizTheme()
        assertEquals(56.dp, theme.cellSize)
        assertEquals(8.dp, theme.cellCornerRadius)
        assertEquals(2.dp, theme.cellBorderWidth)
        assertEquals(22.dp, theme.nodeRadius)
        assertEquals(2.dp, theme.nodeStrokeWidth)
        assertEquals(0.2f, theme.eliminatedOpacity)
    }

    @Test
    fun `custom theme overrides defaults`() {
        val custom = AlgoVizTheme(accent = Color.Red, cellSize = 80.dp)
        assertEquals(Color.Red, custom.accent)
        assertEquals(80.dp, custom.cellSize)
        assertEquals(Color(0xFF0D0F14), custom.background)
    }
}
