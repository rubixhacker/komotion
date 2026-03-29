# Algorithm Visualization Components — Design Spec

**Date:** 2026-03-29
**Status:** Approved (pending user review)

## Problem

Komotion has no built-in primitives for visualizing data structures and algorithms. Channels like BigOBriefs need arrays with highlighting, graphs with traversal animations, trees, stacks, and queues — all driven by frame-based state. Without library components, every channel builds these from scratch.

## Solution

A new `komotion-algo-viz` module providing declarative, state-driven Compose components for common data structure visualizations. Components are pure functions of state — users compute state from frame number using existing `interpolate()` patterns. Fully themeable.

## Design Decisions

1. **Declarative state-driven** (not imperative step-based like manim). Each component takes a data class representing current visual state. Users compute that state from `LocalFrame` using `interpolate()`. This matches Komotion's existing patterns and how BigOBriefs already scripts videos in frame ranges.

2. **commonMain target** — works on all platforms (Android, iOS, Desktop, wasmJs). Preview in KomotionPlayer, export via FfmpegFrameRenderer.

3. **v1 scope:** ArrayViz, GraphViz, TreeViz, StackQueueViz, plus shared theme and state types. Hash maps, heaps, and matrices are v2.

## Module Structure

```
komotion-algo-viz/
  src/commonMain/kotlin/dev/boling/komotion/algoviz/
    theme/
      AlgoVizTheme.kt          -- Theme data class + CompositionLocal
    state/
      ElementState.kt           -- HighlightState enum, shared state types
      ArrayState.kt             -- ArrayVizState, Pointer, SwapAnimation, Partition
      GraphState.kt             -- GraphVizState, Node, Edge, NodeState, EdgeState
      TreeState.kt              -- TreeVizState, TreeNode
      StackQueueState.kt        -- StackQueueVizState
    components/
      ArrayViz.kt               -- Array visualization composable
      GraphViz.kt               -- Graph visualization composable
      TreeViz.kt                -- Binary tree visualization composable
      StackQueueViz.kt          -- Stack/Queue visualization composable
      StepLabel.kt              -- "Step N: description" overlay
      ComparisonIndicator.kt    -- >, <, = symbol between elements
      PointerMarker.kt          -- Arrow/label marker for array indices
  src/commonTest/kotlin/dev/boling/komotion/algoviz/
    state/
      ArrayStateTest.kt
      GraphStateTest.kt
    theme/
      AlgoVizThemeTest.kt
```

## Theme System

```kotlin
data class AlgoVizTheme(
    val background: Color = Color(0xFF0D0F14),
    val surface: Color = Color(0xFF1A1D26),
    val accent: Color = Color(0xFF00FFA3),
    val accent2: Color = Color(0xFF7B61FF),
    val text: Color = Color(0xFFE8EAF0),
    val muted: Color = Color(0xFF6B7280),
    val fontFamily: FontFamily = FontFamily.Monospace,
    val cellSize: Dp = 56.dp,
    val cellCornerRadius: Dp = 8.dp,
    val cellBorderWidth: Dp = 2.dp,
    val nodeRadius: Dp = 22.dp,
    val nodeStrokeWidth: Dp = 2.dp,
    val eliminatedOpacity: Float = 0.2f,
)

val LocalAlgoVizTheme = compositionLocalOf { AlgoVizTheme() }

@Composable
fun AlgoVizThemeProvider(
    theme: AlgoVizTheme = AlgoVizTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalAlgoVizTheme provides theme) {
        content()
    }
}
```

The default theme uses BigOBriefs' brand colors as sensible defaults. Consumers override by providing their own `AlgoVizTheme`.

## Shared State Types

```kotlin
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
```

## ArrayViz

The most critical component — covers arrays, binary search, sorting, sliding window, two pointers.

### State

```kotlin
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
    val color: Color = Color.Unspecified, // Unspecified falls back to theme.accent
)

enum class PointerPosition { Above, Below }

data class Partition(
    val range: IntRange,
    val color: Color,
    val label: String? = null,
)
```

### Component

```kotlin
@Composable
fun ArrayViz(
    state: ArrayVizState,
    modifier: Modifier = Modifier,
)
```

Renders a horizontal row of cells. Each cell shows its value as text, with border/background color determined by `HighlightState`. Pointers render as labeled arrows above or below cells. Partitions render as colored backgrounds spanning cell ranges. Swap animation interpolates cell X positions when `swappingIndices` is set.

### Usage Example (Binary Search)

```kotlin
@Composable
fun BinarySearchStep(lo: Int, hi: Int, mid: Int, found: Boolean) {
    val frame = LocalFrame.current
    val state = ArrayVizState(
        elements = listOf("2", "5", "7", "9", "13", "17", "21"),
        highlights = buildMap {
            for (i in 0 until lo) put(i, HighlightState.Eliminated)
            for (i in hi + 1..6) put(i, HighlightState.Eliminated)
            put(mid, if (found) HighlightState.Found else HighlightState.Active)
        },
        pointers = listOf(
            Pointer(lo, "lo"),
            Pointer(hi, "hi"),
            Pointer(mid, "mid", color = Color(0xFF00FFA3)),
        ),
    )
    ArrayViz(state)
}
```

## GraphViz

Covers BFS/DFS, Dijkstra's, topological sort, cycle detection.

### State

```kotlin
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
    val id: String = "$from->$to",
    val from: String,
    val to: String,
)
```

### Component

```kotlin
@Composable
fun GraphViz(
    state: GraphVizState,
    modifier: Modifier = Modifier,
)
```

Renders nodes as circles with labels, edges as lines (or arrows if `directed`). Node positions are explicit (`x`, `y` as fractions 0..1 of container size) — no auto-layout in v1. Highlight state controls fill/stroke colors. Edge state controls line color/opacity.

### Usage Example (BFS Traversal)

```kotlin
@Composable
fun BfsStep(visited: Set<String>, current: String, queue: List<String>) {
    val state = GraphVizState(
        nodes = listOf(
            GraphNode("A", x = 0.5f, y = 0.1f),
            GraphNode("B", x = 0.25f, y = 0.4f),
            GraphNode("C", x = 0.75f, y = 0.4f),
            // ...
        ),
        edges = listOf(
            GraphEdge(from = "A", to = "B"),
            GraphEdge(from = "A", to = "C"),
            // ...
        ),
        nodeStates = buildMap {
            for (v in visited) put(v, HighlightState.Found)
            put(current, HighlightState.Active)
            for (q in queue) putIfAbsent(q, HighlightState.Comparing)
        },
    )
    GraphViz(state)
}
```

## TreeViz

Binary trees with automatic layout.

### State

```kotlin
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
```

### Component

```kotlin
@Composable
fun TreeViz(
    state: TreeVizState,
    modifier: Modifier = Modifier,
)
```

Renders a binary tree with automatic top-down layout. Each level is spaced evenly vertically, with horizontal spread halving per level. Nodes rendered as circles (same as GraphViz), edges as lines connecting parent to children. Edge IDs are auto-generated as `"parentId->childId"`.

## StackQueueViz

Stacks and queues with push/pop/enqueue/dequeue animations.

### State

```kotlin
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
```

### Component

```kotlin
@Composable
fun StackQueueViz(
    state: StackQueueVizState,
    modifier: Modifier = Modifier,
)
```

- **Stack mode:** Vertical column, newest element at top. Push animates a new element sliding in from above. Pop animates top element sliding out.
- **Queue mode:** Horizontal row, enqueue on right, dequeue on left. Same animation concept.

Cells reuse the same styling as ArrayViz (theme.cellSize, theme.cellCornerRadius, etc.).

## Utility Components

### StepLabel

```kotlin
@Composable
fun StepLabel(
    step: Int,
    description: String,
    modifier: Modifier = Modifier,
)
```

Renders "Step N: description" text using theme font and text color.

### ComparisonIndicator

```kotlin
@Composable
fun ComparisonIndicator(
    left: String,
    right: String,
    operator: ComparisonOp,
    modifier: Modifier = Modifier,
)

enum class ComparisonOp { LessThan, GreaterThan, Equal, NotEqual }
```

Renders "left > right" style comparison with themed colors.

### PointerMarker

Internal component used by ArrayViz, but also exposed publicly for custom layouts:

```kotlin
@Composable
fun PointerMarker(
    label: String,
    position: PointerPosition = PointerPosition.Above,
    color: Color = Color.Unspecified,
    modifier: Modifier = Modifier,
)
```

Renders a labeled arrow pointing at the element below/above.

## Rendering Approach

All components use Compose's `Canvas` for rendering nodes, edges, and arrows, plus `Text` composables for labels and values. This keeps everything in `commonMain` (no platform-specific drawing code). `Canvas` uses `DrawScope` which maps to Skia on all platforms.

Array cells use `Box` + `Text` for the cell structure (leveraging Compose's layout system for spacing, borders, corner radius). This is more idiomatic than pure canvas for grid-like structures.

## Testing Strategy

- **State tests:** Verify state data classes construct correctly, default values work, highlights map properly.
- **Theme tests:** Verify theme defaults match spec, CompositionLocal provides correctly.
- **Rendering tests:** Basic compose-ui-test verifying components don't crash on render with various states. Test edge cases: empty arrays, single-node trees, disconnected graphs.
- **No pixel-perfect tests** in v1 — visual correctness verified through sample app compositions.

## Dependencies

`komotion-algo-viz` depends on:
- `komotion-core` (for `LocalFrame`, `LocalComposition`, `interpolate()`)
- `compose.runtime`, `compose.ui`, `compose.foundation` (Compose UI primitives)

Does NOT depend on `komotion-player` or `komotion-export-desktop`.

## Out of Scope (v2)

- Hash map visualization
- Heap/priority queue visualization
- Matrix/grid visualization
- Auto-layout algorithms for graphs (force-directed, etc.)
- Animation timeline DSL (imperative step sequencing)
- Code block with syntax highlighting
