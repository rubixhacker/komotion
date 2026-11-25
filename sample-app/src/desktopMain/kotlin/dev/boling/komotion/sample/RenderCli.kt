package dev.boling.komotion.sample

import androidx.compose.runtime.Composable
import dev.boling.komotion.core.Composition
import dev.boling.komotion.export.BatchRenderer
import dev.boling.komotion.export.FfmpegFrameRenderer
import dev.boling.komotion.export.PostRenderQc
import dev.boling.komotion.export.PreviewProfile
import dev.boling.komotion.export.RenderRequest
import dev.boling.komotion.sample.compositions.BarChart
import dev.boling.komotion.sample.compositions.FadeIn
import dev.boling.komotion.sample.compositions.TitleCard
import kotlinx.coroutines.runBlocking
import java.io.File

/**
 * Headless renderer entry point used by the `renderVideo` and `watch` Gradle
 * tasks. Selects a single composition by name (or index) via the `komotion.video`
 * system property and writes it to `komotion.output` (default
 * `build/videos/<name>.mp4`).
 *
 * Examples
 * ```
 * ./gradlew :sample-app:renderVideo -Pvideo=TitleCard
 * ./gradlew :sample-app:watch       -Pvideo=TitleCard   # re-render on save
 * ./gradlew :sample-app:renderAll                       # parallel batch
 * ```
 */
object RenderCli {

    @JvmStatic
    fun main(args: Array<String>) {
        val key = System.getProperty("komotion.video")
            ?: args.firstOrNull()
            ?: error("No video selected. Pass -Dkomotion.video=<name> or use the renderVideo Gradle task.")

        val resolved = resolveVideo(key) ?: error(
            "Unknown video '$key'. Known videos: ${registry.keys.joinToString()}"
        )

        val outputPath = System.getProperty("komotion.output")
            ?: "build/videos/${resolved.first}.mp4"
        val outputFile = File(outputPath).also { it.parentFile?.mkdirs() }

        val composition = Composition(
            width = 1920,
            height = 1080,
            durationInFrames = 60,
            fps = 30,
        )

        val previewMode = System.getProperty("komotion.preview")?.toBooleanStrictOrNull() == true
        val skipQc = System.getProperty("komotion.skipQc")?.toBooleanStrictOrNull() == true
        val renderer = FfmpegFrameRenderer(
            previewProfile = if (previewMode) PreviewProfile.Default else null,
            postRenderQc = if (skipQc || previewMode) null else PostRenderQc(),
        )

        val started = System.currentTimeMillis()
        runBlocking {
            renderer.render(
                composition = composition,
                outputPath = outputFile.absolutePath,
                content = resolved.second,
                onProgress = { f ->
                    if (f % 30 == 0 || f == composition.durationInFrames) {
                        println("  $f / ${composition.durationInFrames} frames")
                    }
                },
            )
        }
        val elapsedSec = (System.currentTimeMillis() - started) / 1000.0
        println("✓ Rendered ${resolved.first} -> ${outputFile.absolutePath} in ${"%.1f".format(elapsedSec)}s")
    }

    private fun resolveVideo(key: String): Pair<String, @Composable () -> Unit>? {
        val all = RenderCliRegistry.all()
        all.firstOrNull { it.first == key }?.let { return it }
        val asInt = key.toIntOrNull() ?: return null
        return all.getOrNull(asInt)
    }
}

/**
 * Batch entry point: renders every registered composition in parallel.
 * Wires through [BatchRenderer] so jobs run concurrently up to the default
 * parallelism (`processors / 2`).
 */
object RenderAllCli {

    @JvmStatic
    fun main(args: Array<String>) {
        val requests = RenderCliRegistry.all().map { (name, content) ->
            val out = File("build/videos/$name.mp4").also { it.parentFile?.mkdirs() }
            RenderRequest(
                composition = Composition(1920, 1080, durationInFrames = 60, fps = 30),
                outputPath = out.absolutePath,
                content = content,
            )
        }
        val started = System.currentTimeMillis()
        val results = runBlocking {
            BatchRenderer().renderAll(requests) { req, frame ->
                if (frame % 60 == 0) println("  ${File(req.outputPath).name}: $frame frames")
            }
        }
        val elapsedSec = (System.currentTimeMillis() - started) / 1000.0
        println("Batch finished in ${"%.1f".format(elapsedSec)}s")
        for (r in results) {
            if (r.ok) {
                println("  ✓ ${r.request.outputPath}")
            } else {
                println("  ✗ ${r.request.outputPath}: ${r.error?.message}")
            }
        }
        if (results.any { !it.ok }) error("One or more renders failed")
    }
}

internal object RenderCliRegistry {
    fun all(): List<Pair<String, @Composable () -> Unit>> = listOf(
        "FadeIn" to @Composable { FadeIn() },
        "TitleCard" to @Composable { TitleCard() },
        "BarChart" to @Composable { BarChart() },
    )
}
