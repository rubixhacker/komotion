package dev.boling.komotion.theme

import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

data class KomotionShapes(
    val small: CornerBasedShape = RoundedCornerShape(4.dp),
    val medium: CornerBasedShape = RoundedCornerShape(8.dp),
    val large: CornerBasedShape = RoundedCornerShape(16.dp),
)
