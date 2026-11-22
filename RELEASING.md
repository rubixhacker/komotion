# Releasing Komotion

Komotion publishes to Maven Central under the group `dev.boling.komotion`. All library modules share one version, read from `VERSION_NAME` in `gradle.properties`. The `sample-app` module is not published.

The latest published version is `0.4.1`, released 2026-03-30.

## How publishing works

Each library module applies `gradle/publish.gradle.kts` and uses the Vanniktech Maven Publish plugin. Publication goes to the Sonatype Central Portal. Artifacts are signed when a signing key is supplied. POM metadata, including license, developers and SCM links, is defined in each module's `build.gradle.kts` and sourced from `gradle.properties`.

`.github/workflows/publish.yml` runs on a pushed tag matching `v*`. It first runs `desktopTest`, then calls `publishAndReleaseToMavenCentral`. A local tag does not publish anything. Publishing starts only when the tag reaches GitHub.

## Prerequisites

- The Sonatype Central Portal namespace `dev.boling.komotion` is verified and the publishing account has rights to it.
- The GitHub repository has these secrets:
  - `SONATYPE_USERNAME`
  - `SONATYPE_PASSWORD`
  - `SIGNING_KEY` — the ASCII-armored GPG private key
  - `SIGNING_PASSWORD`
- The public part of the signing key is uploaded to a public keyserver and has not expired. Maven Central verifies signatures against it.

## Release checklist

1. Merge the feature commits and confirm `main` is green.
2. Set `VERSION_NAME` in `gradle.properties` to the new version.
3. Update the version in the README installation snippet.
4. Run `./gradlew build`. This runs the `commonTest` suites across the library modules.
5. Run `./gradlew :sample-app:run` and visually check the sample-app tabs.
6. Commit the version bump and documentation updates.
7. Create an annotated local tag:

   ```sh
   git tag -a vX.Y.Z -m "Release X.Y.Z: short description"
   ```

8. Write the release notes.
9. Push the tag after the visual check and release notes are approved:

   ```sh
   git push origin vX.Y.Z
   ```

10. Watch the `Publish to Maven Central` workflow in GitHub Actions. Both jobs must pass.
11. Verify the published files in the Central repository at `https://repo1.maven.org/maven2/dev/boling/komotion/` and in the Central Portal at `https://central.sonatype.com/namespace/dev.boling.komotion`. Check that each module has a `.pom`, `.module`, sources jar, signatures and checksums for the new version.

## Human approval gates

Two steps stay with a person:

- Visual verification of the sample-app output in step 5.
- Deciding to push the tag in step 9, after release notes are written.

Automation may implement issues, run tests and create a local tag. It must not push the tag or publish artifacts on its own.

## Local checks without credentials

`./gradlew publishToMavenLocal` writes the publications into the local Maven repository. Use it to inspect generated POM and module metadata before a release. It does not require Sonatype or signing credentials.

To upload a staging repository without releasing it, supply the four properties through Gradle properties and use `./gradlew publishAllPublicationsToMavenCentralRepository`. The deployment then waits in the Central Portal; click `Publish` on its Deployments page to release it. The equivalent alias for the upload is `./gradlew publishToMavenCentral`.

## Troubleshooting

- A workflow that fails before publishing usually means a test failure or a missing or incorrect GitHub secret.
- A rejection from the Central Portal usually means missing signatures, invalid POM metadata, or a version that already exists. Maven Central does not allow replacing a published version.
- `search.maven.org` can lag behind the Central repository. Verify against `repo1.maven.org`, which serves the published files directly.
