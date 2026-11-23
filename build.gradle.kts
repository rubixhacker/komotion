plugins {
    alias(libs.plugins.kotlinMultiplatform) apply false
    alias(libs.plugins.composeMultiplatform) apply false
    alias(libs.plugins.composeCompiler) apply false
    alias(libs.plugins.androidApplication) apply false
    alias(libs.plugins.androidLibrary) apply false
    alias(libs.plugins.mavenPublish) apply false
}

// Compiles the main sources of every target in every module. The delivery
// gate and CI run it so a change that breaks a non-desktop target (iOS,
// Android, wasmJs) fails before it is delivered or merged.
//
// The compile tasks are named per target: compileKotlinDesktop,
// compileKotlinWasmJs, compileKotlinIosArm64, ... and, for the Android
// target, per variant: compileDebugKotlinAndroid, compileReleaseKotlinAndroid.
// Matching on the compile task prefix and the Kotlin marker (and skipping the
// test compilations) picks up every main-source compile of every target
// without having to list the targets.
tasks.register("compileAllTargets") {
    dependsOn(subprojects.flatMap { module ->
        module.tasks.filter {
            it.name.startsWith("compile") && it.name.contains("Kotlin") && !it.name.contains("Test")
        }
    })
}
