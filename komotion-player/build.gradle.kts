import com.vanniktech.maven.publish.KotlinMultiplatform
import com.vanniktech.maven.publish.SonatypeHost

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.mavenPublish)
}

apply(from = rootProject.file("gradle/publish.gradle.kts"))

mavenPublishing {
    configure(KotlinMultiplatform(javadocJar = com.vanniktech.maven.publish.JavadocJar.Empty()))
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL)
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
    }

    pom {
        name.set("komotion-player")
        description.set(providers.gradleProperty("POM_DESCRIPTION"))
        url.set(providers.gradleProperty("POM_URL"))
        licenses {
            license {
                name.set(providers.gradleProperty("POM_LICENCE_NAME"))
                url.set(providers.gradleProperty("POM_LICENCE_URL"))
            }
        }
        developers {
            developer {
                id.set(providers.gradleProperty("POM_DEVELOPER_ID"))
                name.set(providers.gradleProperty("POM_DEVELOPER_NAME"))
            }
        }
        scm {
            url.set(providers.gradleProperty("POM_SCM_URL"))
            connection.set(providers.gradleProperty("POM_SCM_CONNECTION"))
            developerConnection.set(providers.gradleProperty("POM_SCM_DEV_CONNECTION"))
        }
    }
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
        commonMain.dependencies {
            implementation(project(":komotion-core"))
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.ui)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            @OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)
            implementation(compose.uiTest)
        }
        val desktopTest by getting {
            dependencies {
                implementation(libs.skiko.awt.runtime.linux.x64)
            }
        }
    }
}

android {
    namespace = "dev.boling.komotion.player"
    compileSdk = 35
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
