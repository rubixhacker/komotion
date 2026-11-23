package dev.boling.komotion.core

import androidx.compose.runtime.Composable

/**
 * A [Composition] registered under an [id], together with the content that renders it
 * and its default properties.
 *
 * Entries are collected into a [CompositionRegistry] so a player or editor can list
 * and select them and pass typed props.
 *
 * @param id A unique identifier within the registry.
 * @param composition The dimensions, frame rate and duration of the animation.
 * @param defaultProps Default values for [props].
 * @param content Receives the entry's [props] and renders the composition.
 */
class CompositionEntry<P : Any>(
    val id: String,
    val composition: Composition,
    val defaultProps: P,
    val content: @Composable (P) -> Unit,
) {
    /**
     * Returns [props] if non-null, otherwise [defaultProps].
     *
     * A player or editor passes the result to [content], so the entry's content
     * always receives the entry's props.
     */
    fun resolveProps(props: P? = null): P = props ?: defaultProps
}

/**
 * A collection of [CompositionEntry]s that a player or editor can list, select
 * and pass typed props to.
 *
 * Entries must have unique ids; a duplicate id is rejected at construction time.
 *
 * Props are typed per entry. `@Serializable` props are only required when an
 * entry is used from the editor, not from this registry.
 */
class CompositionRegistry(entries: List<CompositionEntry<*>>) {
    val entries: List<CompositionEntry<*>> = entries.toList()

    init {
        val seen = mutableSetOf<String>()
        entries.forEach { entry ->
            if (!seen.add(entry.id)) {
                throw IllegalArgumentException("Duplicate composition id: \"${entry.id}\"")
            }
        }
    }

    /** The ids of the registered compositions, in registration order. */
    val ids: List<String>
        get() = entries.map { it.id }

    /**
     * Returns the entry registered under [id], or null if none is.
     */
    @Suppress("UNCHECKED_CAST")
    fun <P : Any> get(id: String): CompositionEntry<P>? =
        entries.firstOrNull { it.id == id } as? CompositionEntry<P>

    /**
     * Returns the entry registered under [id], throwing [NoSuchElementException] if none is.
     */
    fun <P : Any> require(id: String): CompositionEntry<P> =
        get(id) ?: throw NoSuchElementException("No composition registered under id \"$id\"")
}
