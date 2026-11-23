package dev.boling.komotion.core

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class CompositionRegistryTest {

    data class TitleProps(val title: String, val size: Int)

    private val demoComposition = Composition(width = 640, height = 480, durationInFrames = 30)

    private fun entry(
        id: String,
        props: TitleProps,
        content: @Composable (TitleProps) -> Unit,
    ) = CompositionEntry(
        id = id,
        composition = demoComposition,
        defaultProps = props,
        content = content,
    )

    @Test
    fun `get returns the entry with its composition default props and content`() {
        val props = TitleProps("Hello", 42)
        val content: @Composable (TitleProps) -> Unit = { }
        val registry = CompositionRegistry(listOf(entry("title", props, content)))

        val found = registry.get<TitleProps>("title")
        assertIs<CompositionEntry<TitleProps>>(found)
        assertEquals("title", found.id)
        assertEquals(demoComposition, found.composition)
        assertEquals(props, found.defaultProps)
        assertEquals(content, found.content)
    }

    @Test
    fun `get returns null for an unknown id`() {
        val registry = CompositionRegistry(listOf(entry("title", TitleProps("a", 1)) { }))
        assertNull(registry.get<TitleProps>("nope"))
    }

    @Test
    fun `require throws for an unknown id`() {
        val registry = CompositionRegistry(listOf(entry("title", TitleProps("a", 1)) { }))
        val error = assertFailsWith<NoSuchElementException> { registry.require<TitleProps>("nope") }
        assertTrue("nope" in error.message.orEmpty())
    }

    @Test
    fun `entries are listed in registration order`() {
        val registry = CompositionRegistry(
            listOf(
                entry("b", TitleProps("b", 1)) { },
                entry("a", TitleProps("a", 1)) { },
            ),
        )
        assertEquals(listOf("b", "a"), registry.ids)
        assertEquals(2, registry.entries.size)
    }

    @Test
    fun `registry does not alias the input list`() {
        val input = mutableListOf(entry("a", TitleProps("a", 1)) { })
        val registry = CompositionRegistry(input)
        input.add(entry("b", TitleProps("b", 1)) { })
        assertEquals(1, registry.entries.size)
    }

    @Test
    fun `duplicate ids are rejected with a clear error`() {
        val error = assertFailsWith<IllegalArgumentException> {
            CompositionRegistry(
                listOf(
                    entry("dup", TitleProps("a", 1)) { },
                    entry("dup", TitleProps("b", 2)) { },
                ),
            )
        }
        assertTrue("dup" in error.message.orEmpty())
    }

    @Test
    fun `resolveProps returns defaults without props and explicit props when given`() {
        val entry = entry("title", TitleProps("default", 1)) { }
        assertEquals(TitleProps("default", 1), entry.resolveProps())
        val custom = TitleProps("custom", 9)
        assertEquals(custom, entry.resolveProps(custom))
    }

    @Test
    fun `content receives the entry's default props`() = runComposeUiTest {
        var observed: TitleProps? = null
        val props = TitleProps("Hello", 42)
        val registry = CompositionRegistry(listOf(entry("title", props) { p -> observed = p }))

        setContent {
            val entry = registry.require<TitleProps>("title")
            entry.content(entry.resolveProps())
        }

        assertIs<TitleProps>(observed)
        assertEquals("Hello", observed.title)
        assertEquals(42, observed.size)
    }

    @Test
    fun `content receives explicitly passed props when provided`() = runComposeUiTest {
        var observed: TitleProps? = null
        val registry = CompositionRegistry(
            listOf(entry("title", TitleProps("default", 1)) { p -> observed = p }),
        )

        setContent {
            val entry = registry.require<TitleProps>("title")
            entry.content(entry.resolveProps(TitleProps("Custom", 99)))
        }

        assertIs<TitleProps>(observed)
        assertEquals("Custom", observed.title)
        assertEquals(99, observed.size)
    }
}
