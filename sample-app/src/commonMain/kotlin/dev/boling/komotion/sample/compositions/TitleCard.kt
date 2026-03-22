package dev.boling.komotion.sample.compositions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.boling.komotion.core.Sequence
import dev.boling.komotion.core.animateFloatAsFrame

@Composable
fun TitleCard() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xFF1A1A2E)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Sequence(from = 0, durationInFrames = 60) {
                val opacity = animateFloatAsFrame(0..20, 0f..1f)
                val offsetY = animateFloatAsFrame(0..20, 20f..0f)
                Box(modifier = Modifier.offset(y = offsetY.dp)) {
                    Text(
                        text = "Komotion",
                        color = Color.White.copy(alpha = opacity),
                        fontSize = 48.sp,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            Sequence(from = 15, durationInFrames = 45) {
                val opacity = animateFloatAsFrame(0..15, 0f..1f)
                Text(
                    text = "Frame-driven animation for Compose",
                    color = Color(0xFFAAAAAA).copy(alpha = opacity),
                    fontSize = 18.sp,
                )
            }
        }
    }
}
