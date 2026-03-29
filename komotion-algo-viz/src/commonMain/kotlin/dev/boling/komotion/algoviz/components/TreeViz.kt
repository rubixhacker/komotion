package dev.boling.komotion.algoviz.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.boling.komotion.algoviz.state.*

@Composable
fun TreeViz(
    state: TreeVizState,
    modifier: Modifier = Modifier,
) {
    if (state.root == null) return

    val nodes = mutableListOf<GraphNode>()
    val edges = mutableListOf<GraphEdge>()
    layoutTree(state.root, nodes, edges, x = 0.5f, y = 0.1f, spread = 0.25f, levelStep = 0.2f)

    val graphState = GraphVizState(
        nodes = nodes,
        edges = edges,
        nodeStates = state.nodeStates,
        edgeStates = state.edgeStates,
        directed = false,
    )
    GraphViz(state = graphState, modifier = modifier)
}

private fun layoutTree(
    node: TreeNode,
    nodes: MutableList<GraphNode>,
    edges: MutableList<GraphEdge>,
    x: Float,
    y: Float,
    spread: Float,
    levelStep: Float,
) {
    nodes += GraphNode(id = node.id, label = node.label, x = x, y = y)

    node.left?.let { left ->
        val childX = x - spread
        val childY = y + levelStep
        edges += GraphEdge(from = node.id, to = left.id)
        layoutTree(left, nodes, edges, childX, childY, spread / 2f, levelStep)
    }

    node.right?.let { right ->
        val childX = x + spread
        val childY = y + levelStep
        edges += GraphEdge(from = node.id, to = right.id)
        layoutTree(right, nodes, edges, childX, childY, spread / 2f, levelStep)
    }
}
