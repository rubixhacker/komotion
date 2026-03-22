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

private data class Bar(val label: String, val value: Float, val color: Color, val startFrame: Int)

private val bars = listOf(
    Bar("Q1", 0.60f, Color(0xFF4ECDC4), 0),
    Bar("Q2", 0.80f, Color(0xFF45B7D1), 10),
    Bar("Q3", 0.50f, Color(0xFF96CEB4), 20),
    Bar("Q4", 0.95f, Color(0xFFFFEAA7), 30),
)

@Composable
fun BarChart() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xFF1A1A2E)),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Quarterly Results", color = Color.White, fontSize = 20.sp)
            Spacer(Modifier.height(16.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Bottom,
                modifier = Modifier.padding(bottom = 16.dp),
            ) {
                bars.forEach { bar ->
                    Sequence(from = bar.startFrame, durationInFrames = 60 - bar.startFrame) {
                        val heightFraction = animateFloatAsFrame(0..20, 0f..bar.value)
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .width(48.dp)
                                    .height((200 * heightFraction).dp)
                                    .background(bar.color)
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(bar.label, color = Color.White, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}
