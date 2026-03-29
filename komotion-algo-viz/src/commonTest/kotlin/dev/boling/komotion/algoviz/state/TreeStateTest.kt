package dev.boling.komotion.algoviz.state

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TreeStateTest {

    @Test
    fun `TreeNode uses id as default label`() {
        val node = TreeNode(id = "10")
        assertEquals("10", node.label)
        assertNull(node.left)
        assertNull(node.right)
    }

    @Test
    fun `TreeVizState defaults to no highlights`() {
        val root = TreeNode("10", left = TreeNode("5"), right = TreeNode("15"))
        val state = TreeVizState(root = root)
        assertEquals(emptyMap(), state.nodeStates)
        assertEquals(emptyMap(), state.edgeStates)
    }
}
