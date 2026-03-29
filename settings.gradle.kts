pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "komotion"

include(":komotion-core")
include(":komotion-player")
include(":komotion-export-desktop")
include(":sample-app")
include(":komotion-algo-viz")
include(":komotion-theme")
