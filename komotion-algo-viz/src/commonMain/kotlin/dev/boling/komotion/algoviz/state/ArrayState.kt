package dev.boling.komotion.algoviz.state

import androidx.compose.ui.graphics.Color

data class ArrayVizState(
    val elements: List<String>,
    val highlights: Map<Int, HighlightState> = emptyMap(),
    val pointers: List<Pointer> = emptyList(),
    val partitions: List<Partition> = emptyList(),
    val swappingIndices: Pair<Int, Int>? = null,
    val swapProgress: Float = 0f,
)

data class Pointer(
    val index: Int,
    val label: String,
    val position: PointerPosition = PointerPosition.Above,
    val color: Color = Color.Unspecified,
)

enum class PointerPosition { Above, Below }

data class Partition(
    val range: IntRange,
    val color: Color,
    val label: String? = null,
)
