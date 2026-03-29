package dev.boling.komotion.algoviz.state

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class GraphStateTest {

    @Test
    fun `GraphVizState defaults to undirected with no highlights`() {
        val state = GraphVizState(
            nodes = listOf(GraphNode("A", x = 0.5f, y = 0.1f)),
            edges = listOf(GraphEdge(from = "A", to = "B")),
        )
        assertEquals(1, state.nodes.size)
        assertEquals(1, state.edges.size)
        assertEquals(emptyMap(), state.nodeStates)
        assertEquals(emptyMap(), state.edgeStates)
        assertFalse(state.directed)
    }

    @Test
    fun `GraphNode uses id as default label`() {
        val node = GraphNode(id = "X", x = 0.3f, y = 0.7f)
        assertEquals("X", node.label)
    }

    @Test
    fun `GraphEdge auto-generates id from endpoints`() {
        val edge = GraphEdge(from = "A", to = "B")
        assertEquals("A->B", edge.id)
    }
}
