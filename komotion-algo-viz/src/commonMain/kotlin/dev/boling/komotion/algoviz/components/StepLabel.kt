package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import dev.boling.komotion.theme.KomotionTheme

@Composable
fun StepLabel(
    step: Int,
    description: String,
    modifier: Modifier = Modifier,
) {
    val colors = KomotionTheme.colors
    val typography = KomotionTheme.typography
    BasicText(
        text = "Step $step: $description",
        style = TextStyle(
            color = colors.text,
            fontSize = 16.sp,
            fontFamily = typography.fontFamily,
        ),
        modifier = modifier,
    )
}
