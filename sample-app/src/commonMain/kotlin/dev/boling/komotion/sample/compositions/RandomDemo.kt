package dev.boling.komotion.sample.compositions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.boling.komotion.core.ExperimentalKomotionApi
import dev.boling.komotion.core.pick
import dev.boling.komotion.core.random
import dev.boling.komotion.core.randomInRange

/**
 * Scatter of 80 colored particles plus one anchor box, all placed by the
 * pure, seed-based random API: positions via [randomInRange] (Float
 * overloads), sizes via [randomInRange] (Int overload), colors via [pick]
 * over a 4-color palette.
 *
 * Because every value is a pure function of its seed — never of the
 * current frame — re-running the demo reproduces the exact same layout,
 * making the determinism guarantee directly visible.
 */
@OptIn(ExperimentalKomotionApi::class)
@Composable
fun RandomDemo() {
    val palette = listOf(
        Color(0xFFFF5252),
        Color(0xFF52FF52),
        Color(0xFF5252FF),
        Color(0xFFFFD252),
    )

    Box(modifier = Modifier.fillMaxSize().background(Color(0xFF101018))) {
        repeat(80) { i ->
            val x = randomInRange("x-$i", 0f..1800f)
            val y = randomInRange("y-$i", 0f..1000f)
            val size = randomInRange("size-$i", 8..40)
            val color = pick("color-$i", palette)
            Box(
                modifier = Modifier
                    .offset(x = x.dp, y = y.dp)
                    .size(size.dp)
                    .clip(CircleShape)
                    .background(color),
            )
        }

        // The pure `random` variant drives a single deterministic value:
        // the anchor box's horizontal position.
        val anchorX = (random("anchor") * 1700).toFloat()
        Box(
            modifier = Modifier
                .offset(x = anchorX.dp, y = 940.dp)
                .size(120.dp)
                .background(Color.White),
        ) {
            Text(
                text = "anchor",
                color = Color.Black,
                fontSize = 24.sp,
            )
        }
    }
}
