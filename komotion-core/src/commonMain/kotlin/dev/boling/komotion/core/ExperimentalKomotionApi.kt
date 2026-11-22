package dev.boling.komotion.core

/**
 * Marks a Komotion API as experimental.
 *
 * Experimental APIs may change without notice in future releases. Use them with
 * `@OptIn(ExperimentalKomotionApi::class)` (or the compiler's `-opt-in` flag).
 *
 * Usage is a compiler warning, not an error.
 */
@RequiresOptIn(
    level = RequiresOptIn.Level.WARNING,
    message = "This Komotion API is experimental and may change in a future release.",
)
@Retention(AnnotationRetention.BINARY)
@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.FUNCTION,
    AnnotationTarget.PROPERTY,
    AnnotationTarget.TYPEALIAS,
)
public annotation class ExperimentalKomotionApi
