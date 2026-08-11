package ai.shree.companion.protocol

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant

@Serializable
data class ChatEntry(val role: String, val text: String, val timestamp: Long = System.currentTimeMillis())

@Serializable
private data class CompanionCache(
    val memories: List<MemoryItem> = emptyList(),
    val reminders: List<ReminderItem> = emptyList(),
    val systemStatus: SystemStatus = SystemStatus(),
    val chat: List<ChatEntry> = emptyList(),
    val syncedAt: String? = null,
)

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
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    @Volatile private var applicationContext: Context? = null
    val memories = MutableStateFlow<List<MemoryItem>>(emptyList())
    val reminders = MutableStateFlow<List<ReminderItem>>(emptyList())
    val systemStatus = MutableStateFlow(SystemStatus())
    val chat = MutableStateFlow<List<ChatEntry>>(emptyList())
    val lastSync = MutableStateFlow<Instant?>(null)

    fun initialize(context: Context) {
        applicationContext = context.applicationContext
        val encoded = context.getSharedPreferences("shree_companion_cache", Context.MODE_PRIVATE).getString("dashboard", null) ?: return
        runCatching { json.decodeFromString<CompanionCache>(encoded) }.getOrNull()?.let { cache ->
            memories.value = cache.memories
            reminders.value = cache.reminders
            systemStatus.value = cache.systemStatus.copy(online = false, label = "Showing last synced data")
            chat.value = cache.chat.takeLast(50)
            lastSync.value = cache.syncedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        }
    }

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
        persist()
    }

    private fun persist() {
        val context = applicationContext ?: return
        val cache = CompanionCache(memories.value, reminders.value, systemStatus.value, chat.value.takeLast(50), lastSync.value?.toString())
        context.getSharedPreferences("shree_companion_cache", Context.MODE_PRIVATE).edit()
            .putString("dashboard", json.encodeToString(cache)).apply()
    }
}
