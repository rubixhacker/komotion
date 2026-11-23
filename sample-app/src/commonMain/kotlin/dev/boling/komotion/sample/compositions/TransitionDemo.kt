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
import dev.boling.komotion.core.ExperimentalKomotionApi
import dev.boling.komotion.core.TransitionSeries
import dev.boling.komotion.core.currentFrame
import dev.boling.komotion.core.interpolate

/**
 * Four 30-frame scenes chained with 20-frame fade, slide and wipe transitions.
 * The total timeline is 4 * 30 - 3 * 20 = 60 frames.
 */
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun TransitionDemo() {
    TransitionSeries {
        Scene(30) { LabeledScene("Fade", Color(0xFF1A1A2E)) }
        Fade(durationInFrames = 20)
        Scene(30) { LabeledScene("Slide", Color(0xFF4ECDC4)) }
        Slide(durationInFrames = 20)
        Scene(30) { LabeledScene("Wipe", Color(0xFFE76F51)) }
        Wipe(durationInFrames = 20)
        Scene(30) { LabeledScene("Done", Color(0xFF2D6A4F)) }
    }
}

@Composable
private fun LabeledScene(label: String, color: Color) {
    val frame = currentFrame()
    val opacity = interpolate(frame, 0..10, 0f..1f)
    Box(
        modifier = Modifier.fillMaxSize().background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = Color.White.copy(alpha = opacity),
            fontSize = 48.sp,
        )
    }
}
