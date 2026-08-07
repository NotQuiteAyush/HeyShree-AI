package ai.shree.companion.protocol

import android.net.Uri
import android.os.Build
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.decodeFromString
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun supportsPairingPayload(payload: PairingPayload): Boolean =
    payload.protocol in 1..2 && (payload.hosts.isNotEmpty() || payload.relay != null)

class PairingClient(private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(3, TimeUnit.SECONDS).build()) {
    private val json = ProtocolCrypto.json()

    fun parseQr(value: String): PairingPayload {
        val uri = Uri.parse(value)
        require(uri.scheme == "shree" && uri.host == "pair") { "This is not a SHREE pairing code" }
        val encoded = requireNotNull(uri.getQueryParameter("data"))
        val clear = ProtocolCrypto.decode(encoded).decodeToString()
        return runCatching { json.decodeFromString<PairingPayload>(clear) }
            .getOrElse { json.decodeFromString<CompactPairingPayload>(clear).expand() }
    }

    suspend fun pair(payload: PairingPayload, onWaitingForApproval: () -> Unit): PairingCredentials {
        require(supportsPairingPayload(payload)) { "Unsupported pairing code" }
        val key = ProtocolCrypto.decode(payload.key)
        require(key.size == 32) { "Invalid pairing secret" }
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        var relayError: Throwable? = null
        payload.relay?.let { relay ->
            try {
                return pairThroughRelay(payload, relay, key, deviceName, onWaitingForApproval)
            } catch (error: Throwable) {
                if (error is CancellationException || error.message.orEmpty().contains("denied", ignoreCase = true) ||
                    error.message.orEmpty().contains("expired", ignoreCase = true) ||
                    error.message.orEmpty().contains("approval timed out", ignoreCase = true)
                ) throw error
                relayError = error
                if (payload.hosts.isEmpty()) throw IOException("The SHREE worldwide relay was not reachable", error)
            }
        }

        var selectedHost: String? = null
        var lastError: Throwable? = relayError
        for (host in payload.hosts) {
            try {
                val body = PairingRequest(payload.pairingId, deviceName, ProtocolCrypto.proof(key, payload.pairingId, deviceName))
                post(host, "/mobile/pairing/request", json.encodeToString(PairingRequest.serializer(), body))
                selectedHost = host
                break
            } catch (error: Throwable) { lastError = error }
        }
        val host = selectedHost ?: throw IOException(
            "The PC was not reachable through the encrypted relay or local network. Confirm SHREE is running and connected to the internet.",
            lastError,
        )
        onWaitingForApproval()
        repeat(75) {
            delay(2_000)
            val poll = PairingPoll(payload.pairingId, ProtocolCrypto.proof(key, payload.pairingId, "status"))
            val status = json.decodeFromString<PairingStatus>(post(host, "/mobile/pairing/status", json.encodeToString(PairingPoll.serializer(), poll)))
            when (status.status) {
                "approved" -> return PairingCredentials(host, payload.deviceId, key, payload.relay?.url, payload.relay?.roomId, payload.relay?.token)
                "denied" -> error("Pairing was denied on the PC")
                "expired" -> error("Pairing code expired")
            }
        }
        error("Desktop approval timed out")
    }

    private suspend fun pairThroughRelay(
        payload: PairingPayload,
        relay: RelayDescriptor,
        key: ByteArray,
        deviceName: String,
        onWaitingForApproval: () -> Unit,
    ): PairingCredentials {
        val opened = CompletableDeferred<Unit>()
        val incoming = Channel<String>(Channel.UNLIMITED)
        val wsRoot = relay.url.replaceFirst("https://", "wss://")
        val request = Request.Builder().url("$wsRoot/v1/rooms/${relay.roomId}/pairing")
            .addHeader("Authorization", "Bearer ${relay.token}").addHeader("X-Shree-Role", "phone").build()
        val socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { opened.complete(Unit) }
            override fun onMessage(webSocket: WebSocket, text: String) { incoming.trySend(text) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                opened.completeExceptionally(t)
                incoming.close(t)
            }
        })
        try {
            withTimeout(8_000) { opened.await() }
            fun send(message: WireMessage) {
                val envelope = ProtocolCrypto.encrypt(payload.deviceId, key, message)
                check(socket.send(json.encodeToString(EncryptedEnvelope.serializer(), envelope))) { "Remote pairing connection closed" }
            }
            suspend fun receive(): WireMessage = withTimeout(8_000) {
                ProtocolCrypto.decrypt(json.decodeFromString<EncryptedEnvelope>(incoming.receive()), key)
            }

            send(WireMessage(type = "pairing_request", pairingId = payload.pairingId, deviceName = deviceName, proof = ProtocolCrypto.proof(key, payload.pairingId, deviceName)))
            val requested = receive()
            if (requested.status != "pending") error(requested.error ?: "Remote pairing request was rejected")
            onWaitingForApproval()
            repeat(75) {
                delay(2_000)
                send(WireMessage(type = "pairing_poll", pairingId = payload.pairingId, proof = ProtocolCrypto.proof(key, payload.pairingId, "status")))
                when (val status = receive().status) {
                    "approved" -> return PairingCredentials(payload.hosts.firstOrNull().orEmpty(), payload.deviceId, key, relay.url, relay.roomId, relay.token)
                    "denied" -> error("Pairing was denied on the PC")
                    "expired" -> error("Pairing code expired")
                    "pending", "created" -> Unit
                    else -> if (status == "error") error("Remote pairing failed")
                }
            }
            error("Desktop approval timed out")
        } finally {
            socket.close(1000, "Pairing complete")
            incoming.close()
        }
    }

    private suspend fun post(host: String, path: String, body: String): String = suspendCancellableCoroutine { continuation ->
        val request = Request.Builder().url(host + path).post(body.toRequestBody("application/json".toMediaType())).build()
        val call = http.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) = response.use {
                val text = it.body?.string().orEmpty()
                if (!continuation.isActive) return
                if (it.isSuccessful) continuation.resume(text) else continuation.resumeWithException(IOException("${it.code}: $text"))
            }
        })
    }
}
