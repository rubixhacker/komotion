# Komotion

Frame-driven video animation for Compose Multiplatform: compositions are `@Composable` functions where animated values are pure functions of the current frame, so they can be previewed, scrubbed and exported deterministically.

## Philosophy

Build on Compose Multiplatform APIs instead of reimplementing them. See `docs/adr/0001-build-on-compose-multiplatform.md`. Before writing a primitive, look for the Compose API that already provides it (layout, easing, input, text measurement, graphics) and wrap or extend that. Write custom code only for what Compose does not have: frame-driven timing, deterministic offscreen rendering, media collection and export.

Compositions should not require content to know it is inside Komotion. An existing `@Composable` should keep working when placed in a composition, including its own animations.

## Domain vocabulary

Use the terms in `GLOSSARY.md` (Composition, CompositionEntry, Frame, Sequence, Export, RenderJob, Player, Media, Still). Architectural decisions are recorded in `docs/adr/`.

## Modules

| Module | Targets | Purpose |
|--------|---------|---------|
| `komotion-core` | Android, iOS, Desktop, wasmJs | Composition model, Frame/Sequence, interpolation, spring, registry |
| `komotion-media` | Android, iOS, Desktop, wasmJs | In-tree Audio/Video/Image components and the media collector |
| `komotion-captions` | Android, iOS, Desktop, wasmJs | Caption parsing and caption composables |
| `komotion-player` | Android, iOS, Desktop, wasmJs | Embedded preview player and controller |
| `komotion-export-desktop` | Desktop (JVM) | Offscreen rendering and FFmpeg export |
| `komotion-theme` | Android, iOS, Desktop, wasmJs | Colors, typography and shapes |
| `komotion-algo-viz` | Android, iOS, Desktop, wasmJs | Algorithm-visualisation components |
| `sample-app` | Android, iOS, Desktop, wasmJs | Demo compositions and the player sandbox |

## Build and test

- The delivery gate and CI run `./gradlew desktopTest compileAllTargets`: the desktop tests, plus a compile of the main sources of every target in every module, so a change that breaks a non-desktop target (iOS, Android, wasmJs) is caught before it is delivered or merged.
- Run all desktop tests: `./gradlew desktopTest`
- Module tests: `./gradlew :komotion-core:desktopTest` (same pattern for other modules)
- MP4 export tests skip themselves when FFmpeg is not on `PATH`.
- Desktop UI tests need the host OS's Skiko AWT runtime; `gradle/skiko-desktop-test-runtime.gradle` adds it automatically.
- JVM target is 17.

## Conventions

- Kotlin Multiplatform: put shared code in `commonMain`, platform specifics in `androidMain`, `iosMain`, `desktopMain`, `wasmJsMain`.
- Public API lives in `dev.boling.komotion.<module>` packages; keep internal helpers `internal`.
- Every animated value must be a pure function of the frame. Nothing in a composition may read wall-clock time, randomness without a seed, or I/O.
- Tests: `commonTest` for pure logic and composable behaviour (`runComposeUiTest`, Molecule + Turbine), `desktopTest` for rendering and FFmpeg integration.
