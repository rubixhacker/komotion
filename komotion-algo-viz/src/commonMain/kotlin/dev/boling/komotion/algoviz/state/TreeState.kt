package dev.boling.komotion.algoviz.state

data class TreeVizState(
    val root: TreeNode?,
    val nodeStates: Map<String, HighlightState> = emptyMap(),
    val edgeStates: Map<String, HighlightState> = emptyMap(),
)

data class TreeNode(
    val id: String,
    val label: String = id,
    val left: TreeNode? = null,
    val right: TreeNode? = null,
)
