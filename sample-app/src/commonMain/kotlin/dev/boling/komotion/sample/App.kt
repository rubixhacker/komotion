package dev.boling.komotion.sample

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.boling.komotion.core.Composition
import dev.boling.komotion.player.KomotionPlayer
import dev.boling.komotion.sample.compositions.BarChart
import dev.boling.komotion.sample.compositions.FadeIn
import dev.boling.komotion.sample.compositions.TitleCard

private val demos = listOf("FadeIn", "TitleCard", "BarChart")

private val demoComposition = Composition(
    width = 1920,
    height = 1080,
    durationInFrames = 60,
    fps = 30,
)

@Composable
fun App(
    onExportMp4: ((outputPath: String, content: @Composable () -> Unit) -> Unit)? = null,
) {
    var selectedDemo by remember { mutableStateOf(demos.first()) }

    val currentContent: @Composable () -> Unit = when (selectedDemo) {
        "FadeIn" -> { { FadeIn() } }
        "TitleCard" -> { { TitleCard() } }
        else -> { { BarChart() } }
    }

    MaterialTheme {
        Column(modifier = Modifier.fillMaxSize()) {
            TabRow(selectedTabIndex = demos.indexOf(selectedDemo)) {
                demos.forEach { demo ->
                    Tab(
                        selected = demo == selectedDemo,
                        onClick = { selectedDemo = demo },
                        text = { Text(demo) },
                    )
                }
            }

            KomotionPlayer(
                composition = demoComposition,
                modifier = Modifier.weight(1f),
                autoPlay = false,
                content = currentContent,
            )

            if (onExportMp4 != null) {
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { onExportMp4("komotion-output.mp4", currentContent) },
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .fillMaxWidth(),
                ) {
                    Text("Export \"$selectedDemo\" to MP4")
                }
            }
        }
    }
}
