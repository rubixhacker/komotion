package dev.boling.komotion.sample.compositions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import dev.boling.komotion.core.ExperimentalKomotionApi
import dev.boling.komotion.core.Freeze
import dev.boling.komotion.core.LocalFrame

/**
 * Opacity ramp: 0f at frame 0, 1f at frame 30, clamped outside the window.
 */
private fun rampOpacity(frame: Int): Float {
    return (frame / 30f).coerceIn(0f, 1f)
}

@OptIn(ExperimentalKomotionApi::class)
@Composable
fun FreezeDemo() {
    Row(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier.weight(1f).background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            val liveOpacity = rampOpacity(LocalFrame.current)
            Text(
                text = "Live",
                color = Color.White.copy(alpha = liveOpacity),
                fontSize = 36.sp,
            )
        }
        Box(
            modifier = Modifier.weight(1f).background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            Freeze(frame = 15) {
                val frozenOpacity = rampOpacity(LocalFrame.current)
                Text(
                    text = "Frozen at frame 15",
                    color = Color.White.copy(alpha = frozenOpacity),
                    fontSize = 36.sp,
                )
            }
        }
    }
}
