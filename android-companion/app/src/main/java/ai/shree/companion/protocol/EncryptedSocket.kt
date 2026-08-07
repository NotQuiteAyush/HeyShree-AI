package ai.shree.companion.protocol

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

class EncryptedSocket(
    private val credentials: PairingCredentials,
    private val channel: String,
    private val helloType: String,
    private val autoReconnect: Boolean = false,
    private val onMessage: suspend (WireMessage, EncryptedSocket) -> Unit,
) {
    val state = MutableStateFlow("offline")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempts = 0
    @Volatile private var manuallyClosed = false
    private val json = ProtocolCrypto.json()
    private val incoming = Channel<String>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (text in incoming) {
                runCatching {
                    val envelope = json.decodeFromString<EncryptedEnvelope>(text)
                    onMessage(ProtocolCrypto.decrypt(envelope, credentials.key), this@EncryptedSocket)
                }.onFailure { error ->
                    state.value = "error: ${error.message ?: "Encrypted message processing failed"}"
                }
            }
        }
    }

    fun connect() {
        if (socket != null) return
        manuallyClosed = false
        state.value = "connecting"
        val remote = credentials.relayUrl != null && credentials.relayRoomId != null && credentials.relayToken != null
        val request = if (remote) {
            val wsHost = credentials.relayUrl!!.replaceFirst("https://", "wss://")
            Request.Builder().url("$wsHost/v1/rooms/${credentials.relayRoomId}/$channel")
                .addHeader("Authorization", "Bearer ${credentials.relayToken}")
                .addHeader("X-Shree-Role", "phone").build()
        } else {
            val wsHost = credentials.host.replaceFirst("http://", "ws://").replaceFirst("https://", "wss://")
            Request.Builder().url("$wsHost/mobile/$channel/${credentials.deviceId}").build()
        }
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempts = 0
                send(WireMessage(type = helloType)); state.value = "connected"
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (incoming.trySend(text).isFailure) {
                    state.value = "error: Incoming connection closed unexpectedly"
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { socket = null; state.value = "offline"; scheduleReconnect() }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { socket = null; state.value = "error: ${t.message}"; scheduleReconnect() }
        })
    }

    fun send(message: WireMessage): Boolean {
        val envelope = ProtocolCrypto.encrypt(credentials.deviceId, credentials.key, message)
        return socket?.send(json.encodeToString(envelope)) == true
    }

    fun sendResult(id: String, result: JsonElement) = send(WireMessage(type = "phone_command_result", id = id, result = result))
    private fun scheduleReconnect() {
        if (!autoReconnect || manuallyClosed || reconnectJob?.isActive == true) return
        val wait = minOf(2_000L * (1L shl minOf(reconnectAttempts, 4)), 30_000L)
        reconnectAttempts += 1
        reconnectJob = scope.launch { delay(wait); if (!manuallyClosed) connect() }
    }
    fun close() { manuallyClosed = true; reconnectJob?.cancel(); reconnectJob = null; socket?.close(1000, "User disconnected"); socket = null; state.value = "offline" }
    fun destroy() { close(); incoming.close(); scope.cancel(); client.dispatcher.executorService.shutdown() }
}
