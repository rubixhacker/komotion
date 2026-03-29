package dev.boling.komotion.algoviz.state

/**
 * Visual highlight state for any data structure element (cell, node, edge).
 * Components map these to colors using the current AlgoVizTheme.
 */
enum class HighlightState {
    /** No special highlighting — default appearance. */
    Default,
    /** Currently active/being processed. Uses theme.accent. */
    Active,
    /** Being compared to another element. Uses theme.accent2. */
    Comparing,
    /** Target found / operation complete. Uses theme.accent with emphasis. */
    Found,
    /** Eliminated from consideration. Uses theme.muted + eliminatedOpacity. */
    Eliminated,
}
