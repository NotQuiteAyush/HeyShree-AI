package ai.shree.companion.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class PairingPayload(
    val protocol: Int,
    val app: String,
    @SerialName("pairing_id") val pairingId: String,
    @SerialName("device_id") val deviceId: String,
    val key: String,
    val hosts: List<String>,
    val relay: RelayDescriptor? = null,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class RelayDescriptor(
    val url: String,
    @SerialName("room_id") val roomId: String,
    val token: String,
)

@Serializable internal data class CompactRelay(val u: String, val i: String, val t: String)
@Serializable internal data class CompactPairingPayload(
    val p: Int, val i: String, val d: String, val k: String,
    val h: List<String> = emptyList(), val r: CompactRelay? = null, val e: String,
) {
    fun expand() = PairingPayload(
        protocol = p, app = "Shree Companion", pairingId = i, deviceId = d, key = k,
        hosts = h, relay = r?.let { RelayDescriptor(it.u, it.i, it.t) }, expiresAt = e,
    )
}

@Serializable data class PairingRequest(@SerialName("pairing_id") val pairingId: String, @SerialName("device_name") val deviceName: String, val proof: String)
@Serializable data class PairingPoll(@SerialName("pairing_id") val pairingId: String, val proof: String)
@Serializable data class PairingStatus(val status: String, @SerialName("device_id") val deviceId: String)
@Serializable data class EncryptedEnvelope(@SerialName("device_id") val deviceId: String, val timestamp: Long, val nonce: String, val ciphertext: String)

@Serializable
data class MemoryItem(
    val id: String,
    val category: String = "Other",
    val content: String,
    val importance: String = "Medium",
    val confidence: Double = 1.0,
    val timestamp: String = "",
    val pinned: Boolean = false,
)

@Serializable
data class ReminderItem(
    val id: String,
    val text: String,
    @SerialName("due_at") val dueAt: String? = null,
    val recurrence: String? = null,
    val urgent: Boolean = false,
    val completed: Boolean = false,
)

@Serializable data class SystemStatus(val online: Boolean = false, val label: String = "PC unavailable")
@Serializable data class ReminderDraft(val text: String, @SerialName("due_at") val dueAt: String? = null, val urgent: Boolean = false)
@Serializable data class ReminderUpdate(val completed: Boolean? = null)

@Serializable
data class WireMessage(
    val type: String = "",
    val id: String? = null,
    val action: String? = null,
    val arguments: Map<String, JsonElement>? = null,
    val token: String? = null,
    val approved: Boolean? = null,
    val audio: String? = null,
    val text: String? = null,
    val role: String? = null,
    val error: String? = null,
    val result: JsonElement? = null,
    val interrupted: Boolean? = null,
    val memories: List<MemoryItem>? = null,
    val reminders: List<ReminderItem>? = null,
    @SerialName("system_status") val systemStatus: SystemStatus? = null,
    @SerialName("synced_at") val syncedAt: String? = null,
    val reminder: ReminderDraft? = null,
    @SerialName("reminder_id") val reminderId: String? = null,
    val patch: ReminderUpdate? = null,
    @SerialName("device_name") val deviceName: String? = null,
    val proof: String? = null,
    val status: String? = null,
    @SerialName("pairing_id") val pairingId: String? = null,
    @SerialName("device_id") val deviceId: String? = null,
)

data class PairingCredentials(
    val host: String,
    val deviceId: String,
    val key: ByteArray,
    val relayUrl: String? = null,
    val relayRoomId: String? = null,
    val relayToken: String? = null,
)
