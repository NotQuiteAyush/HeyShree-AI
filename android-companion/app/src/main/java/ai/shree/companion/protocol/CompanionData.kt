package ai.shree.companion.protocol

import kotlinx.coroutines.flow.MutableStateFlow
import java.time.Instant

data class ChatEntry(val role: String, val text: String, val timestamp: Long = System.currentTimeMillis())

internal fun mergeTranscriptFragments(current: String, incoming: String): String {
    fun clean(value: String) = value.trim().replace(Regex("\\s+"), " ").replace(Regex("\\s+([\\p{P}])"), "\$1")
    fun comparable(value: String) = value.lowercase().replace(Regex("[\\p{P}]+$"), "")
    val previous = clean(current)
    val next = clean(incoming)
    if (previous.isEmpty()) return next
    if (next.isEmpty() || previous.endsWith(next)) return previous
    if (next.startsWith(previous)) return next
    val previousWords = previous.split(" ")
    val nextWords = next.split(" ")
    for (overlap in minOf(previousWords.size, nextWords.size) downTo 1) {
        val tail = previousWords.takeLast(overlap).joinToString(" ") { comparable(it) }
        val head = nextWords.take(overlap).joinToString(" ") { comparable(it) }
        if (tail == head) return clean((previousWords.dropLast(overlap) + nextWords).joinToString(" "))
    }
    return clean("$previous $next")
}

object CompanionData {
    val memories = MutableStateFlow<List<MemoryItem>>(emptyList())
    val reminders = MutableStateFlow<List<ReminderItem>>(emptyList())
    val systemStatus = MutableStateFlow(SystemStatus())
    val chat = MutableStateFlow<List<ChatEntry>>(emptyList())
    val lastSync = MutableStateFlow<Instant?>(null)

    fun consume(message: WireMessage) {
        message.memories?.let { memories.value = it }
        message.reminders?.let { reminders.value = it }
        message.systemStatus?.let { systemStatus.value = it }
        message.syncedAt?.let { runCatching { Instant.parse(it) }.getOrNull()?.let { instant -> lastSync.value = instant } }
        val text = message.text?.trim().orEmpty()
        if (text.isNotEmpty()) {
            val role = if (message.role == "user") "user" else "model"
            val current = chat.value
            val last = current.lastOrNull()
            chat.value = if (last?.role == role) {
                current.dropLast(1) + ChatEntry(role, mergeTranscriptFragments(last.text, text), last.timestamp)
            } else {
                (current + ChatEntry(role, text)).takeLast(50)
            }
        }
    }
}
