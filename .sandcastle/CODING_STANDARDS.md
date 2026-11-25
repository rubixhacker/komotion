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
- The gate is `./gradlew desktopTest compileAllTargets`; it must pass
  before you commit.

## Modules

- `komotion-core` is the public API; keep it small and dependency-free.
- `komotion-player` builds on core; `komotion-export-desktop` is desktop-only.
- Do not add a dependency to `komotion-core` without a reason stated in the
  change.

## Factory review rules

A review report separates acceptance criteria the change can prove from criteria
that need a live CI run or deployed state. Flag each criterion of the latter
kind `LIVE-EVIDENCE REQUIRED` and report it as unverified from the change, naming
the specific observation that would close it — which check at which commit and
which deployed state must be seen. A spec pass never implies that live
verification happened. Criteria verifiable from the change keep their existing
treatment: judge them from the diff and the available checks. Such a live
observation stays out of scope for a diff review.

**A check fails a branch only when it carries a source diagnostic.** A host
fault, a nested-sandbox refusal or an empty excerpt is not a verdict on the
branch: report it as not checked instead. A repair agent has no file, line or
error to act on, so charging such a failure to a ticket spends repair rounds and
stalls delivery. Two documented Seatbelt refusals are host faults, not defects
in the adapter or the branch: `seatbelt() needs macOS` on a host where the native
provider cannot run, and `sandbox_apply: Operation not permitted` or
`refuses to nest` when a ticket sandbox tries to nest another Seatbelt sandbox.
A review must fail any change that counts one of these against a branch or
presents a diagnostic-free failure as a source fault.

**Guidance that restates changed behavior must change with it.** A branch that
changes a command, a hook step, a lane list or a path must update every place
that restates that behavior — AGENTS.md, the factory and operator guides,
inventories and prompts — or name each stale line as a blocking finding. A line
that still describes the old command, hook step, lane list or path is
documentation drift, not a follow-up to file later. Search the whole repository
for restatements of the old behavior with a pattern loose enough to catch
spelling variants, read every hit, and fix each one in scope. Matching, updated
guidance is not a finding.

**The factory's code lives in this repository.** Lanes run from the dedicated
runtime checkout, never from a scratch directory or an unrelated checkout.
No credential reaches a sandbox: prompts are advice, the environment is the
boundary. A lane that writes to GitHub needs a host-side gate that fails when
the write happens without it. A failing check is fixed at its source;
suppressions, exclusions and relaxed thresholds require explicit permission for
the specific finding.
