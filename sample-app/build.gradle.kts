plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.androidApplication)
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        }
    }
    iosArm64(); iosX64(); iosSimulatorArm64()
    jvm("desktop") {
        compilerOptions {
            jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        }
    }
    wasmJs { browser() }

    sourceSets {
        androidMain.dependencies {
            implementation(libs.androidx.activity.compose)
        }
        commonMain.dependencies {
            implementation(project(":komotion-core"))
            implementation(project(":komotion-player"))
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.ui)
            implementation(compose.material3)
        }
        val desktopMain by getting {
            dependencies {
                implementation(project(":komotion-export-desktop"))
                implementation(compose.desktop.currentOs)
                implementation(libs.kotlinx.coroutines.swing)
            }
        }
    }
}

android {
    namespace = "dev.boling.komotion.sample"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.boling.komotion.sample"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

compose.desktop {
    application {
        mainClass = "dev.boling.komotion.sample.MainKt"
    }
}

// Flip Gradle into continuous mode whenever `watch` is on the command line.
// Equivalent to the user typing --continuous, but as a one-word alias.
// Must run at configuration time — Gradle reads the flag before executing tasks.
if (gradle.startParameter.taskNames.any { it.substringAfterLast(':') == "watch" }) {
    gradle.startParameter.isContinuous = true
}

// ----------------------------------------------------------------------------
// Headless render tasks
// ----------------------------------------------------------------------------
//
//  ./gradlew :sample-app:renderVideo -Pvideo=TitleCard
//      Render one composition by name (or registry index).
//
//  ./gradlew :sample-app:watch -Pvideo=TitleCard
//      Same as renderVideo, but stays in continuous-build mode so any change
//      to a Kotlin source file under sample-app or komotion-* triggers a
//      re-render. Stop with Ctrl-C.
//
//  ./gradlew :sample-app:renderAll
//      Parallel batch render of every registered composition via
//      BatchRenderer.
//
//  ./gradlew :sample-app:previewVideo -Pvideo=TitleCard
//      Fast preview render (240p / 5fps via PreviewProfile.Default).
//
// Optional flags (-P forwarded to system properties):
//      -Poutput=<path>   override output path
//      -PskipQc=true     skip the post-render black-frame check

val desktopRuntimeClasspath = configurations.named("desktopRuntimeClasspath")
val desktopMainCompilation = kotlin.targets.getByName("desktop").compilations.getByName("main")

fun org.gradle.api.tasks.JavaExec.applyVideoSysProps() {
    project.findProperty("video")?.let { systemProperty("komotion.video", it.toString()) }
    project.findProperty("output")?.let { systemProperty("komotion.output", it.toString()) }
    project.findProperty("skipQc")?.let { systemProperty("komotion.skipQc", it.toString()) }
    project.findProperty("preview")?.let { systemProperty("komotion.preview", it.toString()) }
}

tasks.register<JavaExec>("renderVideo") {
    group = "komotion"
    description = "Render a single composition headlessly. Use -Pvideo=<name>."
    dependsOn(desktopMainCompilation.compileTaskProvider)
    mainClass.set("dev.boling.komotion.sample.RenderCli")
    classpath = files(desktopMainCompilation.output.allOutputs, desktopRuntimeClasspath)
    // Inputs/outputs declared so Gradle's --continuous (`-t`) re-runs on
    // source change. Watch mode (below) flips that flag automatically.
    inputs.files(fileTree("src").include("**/*.kt"))
    inputs.files(rootProject.fileTree("komotion-core/src").include("**/*.kt"))
    inputs.files(rootProject.fileTree("komotion-export-desktop/src").include("**/*.kt"))
    inputs.property("video", project.findProperty("video")?.toString() ?: "")
    inputs.property("preview", project.findProperty("preview")?.toString() ?: "")
    outputs.dir(layout.buildDirectory.dir("videos"))
    doFirst { applyVideoSysProps() }
}

tasks.register<JavaExec>("previewVideo") {
    group = "komotion"
    description = "Fast preview render at 240p/5fps. Use -Pvideo=<name>."
    dependsOn(desktopMainCompilation.compileTaskProvider)
    mainClass.set("dev.boling.komotion.sample.RenderCli")
    classpath = files(desktopMainCompilation.output.allOutputs, desktopRuntimeClasspath)
    inputs.files(fileTree("src").include("**/*.kt"))
    inputs.property("video", project.findProperty("video")?.toString() ?: "")
    outputs.dir(layout.buildDirectory.dir("videos"))
    doFirst {
        applyVideoSysProps()
        systemProperty("komotion.preview", "true")
    }
}

tasks.register("watch") {
    group = "komotion"
    description = "Re-render the chosen video on every source-file save (Ctrl-C to stop)."
    dependsOn("renderVideo")
    // Continuous mode is enabled at the top of this file by inspecting
    // startParameter.taskNames before the task graph is built.
}

tasks.register<JavaExec>("renderAll") {
    group = "komotion"
    description = "Batch-render every registered composition in parallel."
    dependsOn(desktopMainCompilation.compileTaskProvider)
    mainClass.set("dev.boling.komotion.sample.RenderAllCli")
    classpath = files(desktopMainCompilation.output.allOutputs, desktopRuntimeClasspath)
    outputs.dir(layout.buildDirectory.dir("videos"))
    doFirst { applyVideoSysProps() }
}
