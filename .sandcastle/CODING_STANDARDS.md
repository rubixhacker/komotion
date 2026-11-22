# Coding Standards

## Language

- Kotlin, Compose Multiplatform. The core API is common code; platform code
  lives in the `androidMain`, `iosMain`, `desktopMain` and `wasmJsMain`
  source sets.
- Follow the existing naming: `camelCase` for functions and properties,
  `PascalCase` for types, `UpperCamelCase` for composables.
- No escape hatches: use explicit types, `null` with care, and exhaustive
  `when` over the library's sealed hierarchies.

## Animation model

- Every animation is a pure function of the current frame number. A frame's
  value must never depend on wall-clock time or on mutable state outside the
  composition.
- Frame windows are inclusive of `from` and exclusive of
  `from + durationInFrames`.
- Interpolation and easing helpers must be total: no exceptions on edge
  frames (frame 0, the last frame, out-of-window frames).

## Testing

- Every public function has at least one test in the module's `commonTest`
  source set.
- Pure logic uses `kotlin.test`; composition behavior uses
  `runComposeUiTest` (desktop UI tests).
- The gate is `./gradlew desktopTest`; it must pass before you commit.

## Modules

- `komotion-core` is the public API; keep it small and dependency-free.
- `komotion-player` builds on core; `komotion-export-desktop` is desktop-only.
- Do not add a dependency to `komotion-core` without a reason stated in the
  change.
