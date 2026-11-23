package dev.boling.komotion.media

import androidx.compose.runtime.compositionLocalOf

/**
 * Collects [Media] declarations made by composable content.
 *
 * The host (player, exporter, tests) creates a collector, provides it via
 * [LocalMediaCollector] and sets [frame] to the global frame before each
 * composition pass. Declarations are recorded once per call site (identified
 * by a [MediaToken]) and accumulate across frames, so an export that composes
 * every frame ends up with the union of all media declared in any active
 * sequence window.
 */
class MediaCollector {

    /**
     * The global frame during the current composition pass.
     *
     * Set by the host before each composition pass; read by media composables
     * to shift their local start frames onto the global timeline.
     */
    var frame: Int = 0

    private val declarations = LinkedHashMap<MediaToken, Media>()

    /** Registers or updates the declaration for [token]. */
    fun register(token: MediaToken, media: Media) {
        declarations[token] = media
    }

    /** All declarations recorded so far, in declaration order. */
    fun snapshot(): List<Media> = declarations.values.toList()

    /** Removes all declarations. */
    fun clear() {
        declarations.clear()
    }
}

/** Identifies a media call site so repeated compositions do not duplicate it. */
class MediaToken

private val defaultMediaCollector = MediaCollector()

/**
 * The [MediaCollector] that media composables register with.
 *
 * The host should provide its own collector (see [MediaCollector]); if none is
 * provided, declarations fall into a shared default collector.
 */
val LocalMediaCollector = compositionLocalOf { defaultMediaCollector }
