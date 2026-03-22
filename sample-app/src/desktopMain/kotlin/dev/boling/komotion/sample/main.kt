package dev.boling.komotion.sample

import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import dev.boling.komotion.core.Composition
import dev.boling.komotion.export.FfmpegFrameRenderer

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "Komotion Sample") {
        val scope = rememberCoroutineScope()
        val renderer = FfmpegFrameRenderer()
        App(
            onExportMp4 = { outputPath, content ->
                renderer.renderAsync(
                    composition = Composition(1920, 1080, durationInFrames = 60, fps = 30),
                    outputPath = outputPath,
                    content = content,
                    scope = scope,
                )
            }
        )
    }
}
