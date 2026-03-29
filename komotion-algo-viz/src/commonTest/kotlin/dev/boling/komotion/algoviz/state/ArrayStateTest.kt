package dev.boling.komotion.algoviz.state

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArrayStateTest {

    @Test
    fun `ArrayVizState defaults to empty highlights and pointers`() {
        val state = ArrayVizState(elements = listOf("1", "2", "3"))
        assertEquals(3, state.elements.size)
        assertEquals(emptyMap(), state.highlights)
        assertEquals(emptyList(), state.pointers)
        assertEquals(emptyList(), state.partitions)
        assertNull(state.swappingIndices)
        assertEquals(0f, state.swapProgress)
    }

    @Test
    fun `Pointer defaults to Above position and Unspecified color`() {
        val pointer = Pointer(index = 2, label = "mid")
        assertEquals(2, pointer.index)
        assertEquals("mid", pointer.label)
        assertEquals(PointerPosition.Above, pointer.position)
        assertEquals(Color.Unspecified, pointer.color)
    }

    @Test
    fun `Partition captures range and color`() {
        val partition = Partition(range = 0..3, color = Color.Red, label = "left")
        assertEquals(0..3, partition.range)
        assertEquals(Color.Red, partition.color)
        assertEquals("left", partition.label)
    }
}
