package dev.boling.komotion.sample.compositions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import dev.boling.komotion.core.currentFrame
import dev.boling.komotion.core.interpolate

@Composable
fun FadeIn() {
    val frame = currentFrame()
    val opacity = interpolate(frame, 0..30, 0f..1f)
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "Hello, Komotion!",
            color = Color.White.copy(alpha = opacity),
            fontSize = 36.sp,
        )
    }
}
