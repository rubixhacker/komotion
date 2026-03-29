package dev.boling.komotion.algoviz.theme

import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

class AlgoVizSizingTest {
    @Test
    fun `default sizing matches original AlgoVizTheme values`() {
        val sizing = AlgoVizSizing()
        assertEquals(56.dp, sizing.cellSize)
        assertEquals(2.dp, sizing.cellBorderWidth)
        assertEquals(22.dp, sizing.nodeRadius)
        assertEquals(2.dp, sizing.nodeStrokeWidth)
        assertEquals(0.2f, sizing.eliminatedOpacity)
    }

    @Test
    fun `custom sizing overrides defaults`() {
        val custom = AlgoVizSizing(cellSize = 80.dp)
        assertEquals(80.dp, custom.cellSize)
        assertEquals(2.dp, custom.cellBorderWidth)
    }
}
