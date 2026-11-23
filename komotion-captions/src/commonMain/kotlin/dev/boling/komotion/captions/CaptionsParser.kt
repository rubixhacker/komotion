package dev.boling.komotion.captions

private val timestampPattern = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}[,.]\\d{1,9}"
private val timestampLineRegex = Regex("^\\s*($timestampPattern)\\s+-->\\s+($timestampPattern)\\s*$")
private val identifierLineRegex = Regex("^\\s*\\d+\\s*$")

/**
 * Parses SRT text into [Caption]s, converting millisecond timestamps to frames at [fps].
 *
 * Each cue needs a numeric index line, a `HH:MM:SS,mmm --> HH:MM:SS,mmm` timestamp
 * line, and at least one text line. Cues are separated by one or more blank lines.
 * Multi-line cue text is preserved, with line breaks kept between the lines.
 *
 * @throws IllegalArgumentException on malformed input (missing index, bad timestamp,
 *   empty cue, empty file).
 */
fun parseSrt(text: String, fps: Int): List<Caption> =
    parseBlocksFrom(normalizeLines(text), 0, fps, requireIdentifier = true)

/**
 * Parses WebVTT text into [Caption]s, converting millisecond timestamps to frames at [fps].
 *
 * The text must start with a `WEBVTT` header line. An optional file identifier line
 * is skipped. Cue identifiers are optional.
 *
 * @throws IllegalArgumentException on malformed input (missing header, bad timestamp,
 *   empty cue, empty file).
 */
fun parseVtt(text: String, fps: Int): List<Caption> {
    val lines = normalizeLines(text)
    var i = 0
    while (i < lines.size && lines[i].isBlank()) i++
    require(i < lines.size) { "no cues found: file is empty" }
    require(lines[i].startsWith("WEBVTT", ignoreCase = true)) {
        "missing WEBVTT header: first line is '${lines[i].take(40)}'"
    }
    i++
    while (i < lines.size && lines[i].isBlank()) i++
    // The spec allows a single file identifier line after the header.
    if (i < lines.size && !isTimestampLine(lines[i])) {
        i++
    }
    return parseBlocksFrom(lines, i, fps)
}

/**
 * Parses SRT or WebVTT text, auto-detecting the format from the `WEBVTT` header.
 *
 * @throws IllegalArgumentException on malformed input.
 */
fun parseCaptions(text: String, fps: Int): List<Caption> {
    val firstNonBlank = normalizeLines(text).firstOrNull { !it.isBlank() }
    return if (firstNonBlank != null && firstNonBlank.startsWith("WEBVTT", ignoreCase = true)) {
        parseVtt(text, fps)
    } else {
        parseSrt(text, fps)
    }
}

private fun parseBlocksFrom(
    lines: List<String>,
    start: Int,
    fps: Int,
    requireIdentifier: Boolean = false,
): List<Caption> {
    require(fps > 0) { "fps must be positive, got $fps" }
    val captions = mutableListOf<Caption>()
    var i = start
    while (i < lines.size) {
        while (i < lines.size && lines[i].isBlank()) i++
        if (i >= lines.size) break
        i = parseBlock(lines, i, fps, requireIdentifier, captions)
    }
    require(captions.isNotEmpty()) { "no cues found" }
    return captions
}

private fun parseBlock(
    lines: List<String>,
    start: Int,
    fps: Int,
    requireIdentifier: Boolean,
    captions: MutableList<Caption>,
): Int {
    var i = start
    var identifier: String? = null
    if (isIdentifierLine(lines[i])) {
        identifier = lines[i].trim()
        i++
        require(i < lines.size) {
            "cue $identifier has no timestamp line"
        }
    } else if (requireIdentifier) {
        require(false) {
            "cue at line ${i + 1} is missing its index line: '${lines[i].take(40)}'"
        }
    }
    require(isTimestampLine(lines[i])) {
        "malformed timestamp line ${i + 1}: '${lines[i].take(40)}'"
    }
    val (startMs, endMs) = parseTimestampPair(lines[i])
    require(endMs >= startMs) {
        "cue at line ${i + 1} ends before it starts"
    }
    i++
    val textLines = mutableListOf<String>()
    while (i < lines.size && !lines[i].isBlank()) {
        textLines += lines[i]
        i++
    }
    require(textLines.isNotEmpty()) {
        "cue ${identifier ?: "at line ${start + 1}"} has no text"
    }
    captions += Caption(
        text = textLines.joinToString("\n"),
        startFrame = millisToFrames(startMs, fps),
        endFrame = millisToFrames(endMs, fps),
    )
    return i
}

private fun normalizeLines(text: String): List<String> =
    text.replace("\r\n", "\n").replace('\r', '\n').removePrefix("\uFEFF").lines()

private fun isTimestampLine(line: String): Boolean = timestampLineRegex.containsMatchIn(line)

private fun isIdentifierLine(line: String): Boolean = identifierLineRegex.matches(line)

private fun parseTimestampPair(line: String): Pair<Long, Long> {
    val match = timestampLineRegex.find(line)
    requireNotNull(match) {
        "malformed timestamp line: '${line.take(40)}'"
    }
    return parseTimestamp(match.groupValues[1]) to parseTimestamp(match.groupValues[2])
}

private fun parseTimestamp(token: String): Long {
    val parts = token.split(':')
    val (hours, minutes, secondsAndMs) = when (parts.size) {
        2 -> Triple(0L, parts[0].toLong(), parts[1])
        3 -> Triple(parts[0].toLong(), parts[1].toLong(), parts[2])
        else -> throw IllegalArgumentException("malformed timestamp: '$token'")
    }
    val separator = secondsAndMs.indexOfAny(charArrayOf(',', '.'))
    val seconds = secondsAndMs.substring(0, separator).toLong()
    val millis = secondsAndMs.substring(separator + 1).padEnd(3, '0').take(3).toLong()
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
}

private fun millisToFrames(ms: Long, fps: Int): Int {
    val frames = ms * fps / 1000
    require(frames in Int.MIN_VALUE..Int.MAX_VALUE) {
        "timestamp out of frame range: ${ms} ms at ${fps} fps"
    }
    return frames.toInt()
}
