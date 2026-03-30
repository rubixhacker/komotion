package dev.boling.komotion.algoviz.state

data class GraphVizState(
    val nodes: List<GraphNode>,
    val edges: List<GraphEdge>,
    val nodeStates: Map<String, HighlightState> = emptyMap(),
    val edgeStates: Map<String, HighlightState> = emptyMap(),
    val directed: Boolean = false,
)

data class GraphNode(
    val id: String,
    val label: String = id,
    val x: Float,
    val y: Float,
)

data class GraphEdge(
    val from: String,
    val to: String,
    val id: String = "$from->$to",
    val label: String? = null,
)
