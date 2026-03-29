package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.boling.komotion.algoviz.state.PointerPosition
import dev.boling.komotion.algoviz.theme.LocalAlgoVizTheme

@Composable
fun PointerMarker(
    label: String,
    position: PointerPosition = PointerPosition.Above,
    color: Color = Color.Unspecified,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current
    val resolvedColor = if (color == Color.Unspecified) theme.accent else color

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier,
    ) {
        if (position == PointerPosition.Below) {
            Canvas(modifier = Modifier.size(12.dp, 8.dp)) {
                val path = Path().apply {
                    moveTo(size.width / 2, 0f)
                    lineTo(0f, size.height)
                    lineTo(size.width, size.height)
                    close()
                }
                drawPath(path, resolvedColor, style = Fill)
            }
        }

        BasicText(
            text = label,
            style = TextStyle(
                color = resolvedColor,
                fontSize = 11.sp,
                fontFamily = theme.fontFamily,
            ),
        )

        if (position == PointerPosition.Above) {
            Canvas(modifier = Modifier.size(12.dp, 8.dp)) {
                val path = Path().apply {
                    moveTo(0f, 0f)
                    lineTo(size.width, 0f)
                    lineTo(size.width / 2, size.height)
                    close()
                }
                drawPath(path, resolvedColor, style = Fill)
            }
        }
    }
}
