package dev.boling.komotion.algoviz.state

data class StackQueueVizState(
    val elements: List<String>,
    val highlights: Map<Int, HighlightState> = emptyMap(),
    val mode: StackQueueMode = StackQueueMode.Stack,
    val pushingElement: String? = null,
    val pushProgress: Float = 0f,
    val poppingIndex: Int? = null,
    val popProgress: Float = 0f,
)

enum class StackQueueMode { Stack, Queue }
