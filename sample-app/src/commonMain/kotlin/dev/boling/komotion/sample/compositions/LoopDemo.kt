package dev.boling.komotion.sample.compositions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.boling.komotion.core.ExperimentalKomotionApi
import dev.boling.komotion.core.Loop
import dev.boling.komotion.core.LocalFrame

private const val CYCLE = 15

/**
 * A single box pulses on a 15-frame cycle (scale 1.0 -> 1.4 -> 1.0), repeating
 * four times across the 60-frame composition.
 */
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun LoopDemo() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Loop(durationInFrames = CYCLE) {
            val scale = pulseScale(LocalFrame.current)
            Box(
                modifier = Modifier
                    .size(120.dp * scale)
                    .background(Color(0xFF4ECDC4), shape = RoundedCornerShape(16.dp)),
            )
        }
    }
}

/**
 * A triangle wave from 1.0 to 1.4 and back over one [CYCLE]-frame loop.
 */
private fun pulseScale(frame: Int): Float {
    val peak = CYCLE / 2
    val fraction = if (frame <= peak) {
        frame / peak.toFloat()
    } else {
        (CYCLE - 1 - frame) / peak.toFloat()
    }
    return 1.0f + 0.4f * fraction
}
