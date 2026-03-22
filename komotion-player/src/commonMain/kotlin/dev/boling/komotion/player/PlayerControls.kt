package dev.boling.komotion.player

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Transport controls bar for [KomotionPlayer].
 *
 * @param currentFrame The currently displayed frame index.
 * @param totalFrames Total number of frames in the composition.
 * @param isPlaying Whether playback is active.
 * @param loop Whether playback loops.
 * @param onPlayPause Called when the play/pause button is tapped.
 * @param onSkipToStart Called when the skip-to-start button is tapped.
 * @param onSkipToEnd Called when the skip-to-end button is tapped.
 * @param onScrub Called with a new frame index when the scrubber moves.
 * @param onLoopToggle Called when the loop button is tapped.
 */
@Composable
fun PlayerControls(
    currentFrame: Int,
    totalFrames: Int,
    isPlaying: Boolean,
    loop: Boolean,
    onPlayPause: () -> Unit,
    onSkipToStart: () -> Unit,
    onSkipToEnd: () -> Unit,
    onScrub: (Int) -> Unit,
    onLoopToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onSkipToStart) {
            Icon(Icons.Filled.SkipPrevious, contentDescription = "Skip to start")
        }
        IconButton(onClick = onPlayPause) {
            Icon(
                if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (isPlaying) "Pause" else "Play",
            )
        }
        IconButton(onClick = onSkipToEnd) {
            Icon(Icons.Filled.SkipNext, contentDescription = "Skip to end")
        }

        Slider(
            value = currentFrame.toFloat(),
            onValueChange = { onScrub(it.toInt()) },
            valueRange = 0f..(totalFrames - 1).coerceAtLeast(1).toFloat(),
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
        )

        Text(
            text = "$currentFrame / ${totalFrames - 1}",
            fontSize = 12.sp,
            modifier = Modifier.width(72.dp),
        )

        IconButton(onClick = onLoopToggle) {
            Icon(
                Icons.Filled.Repeat,
                contentDescription = if (loop) "Disable loop" else "Enable loop",
            )
        }
    }
}
