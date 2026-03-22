// Shared publishing configuration applied by each library module.
// Usage: apply(from = rootProject.file("gradle/publish.gradle.kts"))

val groupId = providers.gradleProperty("GROUP").get()
val versionName = providers.gradleProperty("VERSION_NAME").get()

group = groupId
version = versionName
