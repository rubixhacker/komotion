package dev.boling.komotion.algoviz.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.boling.komotion.algoviz.theme.LocalAlgoVizTheme

enum class ComparisonOp(val symbol: String) {
    LessThan("<"),
    GreaterThan(">"),
    Equal("="),
    NotEqual("\u2260"),
}

@Composable
fun ComparisonIndicator(
    left: String,
    right: String,
    operator: ComparisonOp,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAlgoVizTheme.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        BasicText(
            text = left,
            style = TextStyle(color = theme.accent, fontSize = 18.sp, fontFamily = theme.fontFamily),
        )
        Spacer(Modifier.width(8.dp))
        BasicText(
            text = operator.symbol,
            style = TextStyle(color = theme.text, fontSize = 18.sp, fontFamily = theme.fontFamily),
        )
        Spacer(Modifier.width(8.dp))
        BasicText(
            text = right,
            style = TextStyle(color = theme.accent2, fontSize = 18.sp, fontFamily = theme.fontFamily),
        )
    }
}
