package dev.boling.komotion.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

data class KomotionTypography(
    val fontFamily: FontFamily = FontFamily.Monospace,
    val display: TextStyle = TextStyle(fontSize = 48.sp),
    val title: TextStyle = TextStyle(fontSize = 24.sp),
    val body: TextStyle = TextStyle(fontSize = 16.sp),
    val label: TextStyle = TextStyle(fontSize = 12.sp),
    val code: TextStyle = TextStyle(fontSize = 14.sp, fontFamily = FontFamily.Monospace),
)
