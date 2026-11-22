# Komotion

Komotion is a Kotlin and Compose toolkit for authoring frame-driven video compositions: every animated value is a pure function of the current frame, so the same composition can be previewed, scrubbed and exported.

## Language

**Composition**:
The description of a video: its width, height, frame rate and duration in frames.
_Avoid_: VideoConfig, CompositionConfig, PlayerProps

**CompositionEntry**:
A Composition registered under an id, together with the content that renders it and its default properties.
_Avoid_: Composition (for a registration), Registration, Video

**Frame**:
A zero-based index of a moment in a video timeline. Inside a Sequence, a Frame is measured relative to that Sequence's start.
_Avoid_: Tick, Timestamp, Timecode

**Sequence**:
A time-windowed subtree of a Composition that owns a Frame clock re-based to its own start.
_Avoid_: Segment, Clip, Scene

**Export**:
Producing a final media file from a Composition. Rendering produces individual frames; Export encodes them.
_Avoid_: Render (when a media file is the result)

**RenderJob**:
A handle to an Export in progress, reporting progress, completion, failure and cancellation.
_Avoid_: Task, Job, ExportHandle

**Player**:
The embedded preview widget that plays and scrubs a Composition inside an app.
_Avoid_: Previewer, Viewer, Playback

**Media**:
Audio, video or images declared inside a Composition's tree, which both preview and Export collect.
_Avoid_: Assets, Resources, Attachments

**Still**:
A single Frame exported as an image file rather than a video.
_Avoid_: Snapshot, Screenshot, Thumbnail
