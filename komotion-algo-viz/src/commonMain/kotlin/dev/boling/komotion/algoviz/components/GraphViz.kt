package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import dev.boling.komotion.algoviz.state.*
import dev.boling.komotion.algoviz.theme.LocalAlgoVizSizing
import dev.boling.komotion.theme.KomotionColors
import dev.boling.komotion.theme.KomotionTheme

/**
 * Renders a graph with nodes as circles and edges as lines.
 * Node positions are explicit (x, y as fractions 0..1 of container).
 */
@Composable
fun GraphViz(
    state: GraphVizState,
    modifier: Modifier = Modifier,
) {
    val colors = KomotionTheme.colors
    val sizing = LocalAlgoVizSizing.current
    val typography = KomotionTheme.typography
    val textMeasurer = rememberTextMeasurer()

    Canvas(modifier = modifier.fillMaxSize()) {
        val nodeRadiusPx = sizing.nodeRadius.toPx()
        val strokeWidthPx = sizing.nodeStrokeWidth.toPx()

        // Build node position lookup
        val nodePositions = state.nodes.associate { node ->
            node.id to Offset(node.x * size.width, node.y * size.height)
        }

        // Draw edges
        for (edge in state.edges) {
            val fromPos = nodePositions[edge.from] ?: continue
            val toPos = nodePositions[edge.to] ?: continue
            val edgeHighlight = state.edgeStates[edge.id] ?: HighlightState.Default
            val edgeColor = resolveNodeColor(edgeHighlight, colors)
            val edgeAlpha = if (edgeHighlight == HighlightState.Eliminated) {
                sizing.eliminatedOpacity
            } else {
                1f
            }

            drawLine(
                color = edgeColor,
                start = fromPos,
                end = toPos,
                strokeWidth = strokeWidthPx,
                alpha = edgeAlpha,
            )

            // Draw arrowhead for directed graphs
            if (state.directed) {
                drawArrowhead(fromPos, toPos, nodeRadiusPx, edgeColor, edgeAlpha)
            }
        }

        // Draw nodes
        for (node in state.nodes) {
            val pos = nodePositions[node.id] ?: continue
            val highlight = state.nodeStates[node.id] ?: HighlightState.Default
            val nodeColor = resolveNodeColor(highlight, colors)
            val fillColor = resolveNodeFill(highlight, colors)
            val nodeAlpha = if (highlight == HighlightState.Eliminated) {
                sizing.eliminatedOpacity
            } else {
                1f
            }

            // Fill
            drawCircle(
                color = fillColor,
                radius = nodeRadiusPx,
                center = pos,
                alpha = nodeAlpha,
            )
            // Stroke
            drawCircle(
                color = nodeColor,
                radius = nodeRadiusPx,
                center = pos,
                style = Stroke(width = strokeWidthPx),
                alpha = nodeAlpha,
            )

            // Label
            val textLayout = textMeasurer.measure(
                text = node.label,
                style = TextStyle(
                    color = colors.text,
                    fontSize = 14.sp,
                    fontFamily = typography.fontFamily,
                    textAlign = TextAlign.Center,
                ),
            )
            drawText(
                textLayoutResult = textLayout,
                topLeft = Offset(
                    pos.x - textLayout.size.width / 2f,
                    pos.y - textLayout.size.height / 2f,
                ),
            )
        }
    }
}

private fun resolveNodeColor(
    highlight: HighlightState,
    colors: KomotionColors,
): Color = when (highlight) {
    HighlightState.Default -> colors.muted
    HighlightState.Active -> colors.accent
    HighlightState.Comparing -> colors.accent2
    HighlightState.Found -> colors.accent
    HighlightState.Eliminated -> colors.muted
}

private fun resolveNodeFill(
    highlight: HighlightState,
    colors: KomotionColors,
): Color = when (highlight) {
    HighlightState.Default -> colors.surface
    HighlightState.Active -> colors.accent.copy(alpha = 0.15f)
    HighlightState.Comparing -> colors.accent2.copy(alpha = 0.15f)
    HighlightState.Found -> colors.accent.copy(alpha = 0.3f)
    HighlightState.Eliminated -> colors.surface
}

private fun DrawScope.drawArrowhead(
    from: Offset,
    to: Offset,
    nodeRadius: Float,
    color: Color,
    alpha: Float,
) {
    val dx = to.x - from.x
    val dy = to.y - from.y
    val dist = kotlin.math.sqrt(dx * dx + dy * dy)
    if (dist == 0f) return

    val unitX = dx / dist
    val unitY = dy / dist

    // Arrowhead tip stops at the node edge
    val tipX = to.x - unitX * nodeRadius
    val tipY = to.y - unitY * nodeRadius

    val arrowSize = 10f
    val perpX = -unitY * arrowSize * 0.5f
    val perpY = unitX * arrowSize * 0.5f
    val baseX = tipX - unitX * arrowSize
    val baseY = tipY - unitY * arrowSize

    val path = Path().apply {
        moveTo(tipX, tipY)
        lineTo(baseX + perpX, baseY + perpY)
        lineTo(baseX - perpX, baseY - perpY)
        close()
    }
    drawPath(path, color, alpha = alpha, style = Fill)
}
