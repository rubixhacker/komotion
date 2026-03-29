package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import dev.boling.komotion.algoviz.theme.LocalAlgoVizTheme

@Composable
fun StepLabel(
    step: Int,
    description: String,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current
    BasicText(
        text = "Step $step: $description",
        style = TextStyle(
            color = theme.text,
            fontSize = 16.sp,
            fontFamily = theme.fontFamily,
        ),
        modifier = modifier,
    )
}
