# Build on Compose Multiplatform APIs instead of reimplementing them

Komotion's value is the frame-driven video layer, not the UI, animation or layout primitives underneath it. We decided that whenever Compose Multiplatform already provides a concept (layout, animation curves, text and measurement, gestures, focus and input, graphics), Komotion builds on that API or wraps it, and only writes its own implementation for the parts Compose does not have: frame-driven timing, deterministic offscreen rendering, media collection and export.

Considered option: implement self-contained primitives inside Komotion so the library has no Compose dependency beyond the runtime. Rejected because it duplicates mature code, drifts from upstream fixes, and would still need Compose to render compositions.

Consequences: new features should first look for an existing Compose API (for example `Easing` for curves, `ComposeScene` for rendering, standard layout and input modifiers). Where we deliberately diverge, record it. Testing follows the same principle: use the Compose test runtime rather than a hand-rolled harness.
