package ai.shree.companion.protocol

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object ProtocolCrypto {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val seen = ConcurrentHashMap<String, Long>()

    fun base64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
    fun audioBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun decodeAudio(value: String): ByteArray = Base64.getDecoder().decode(value)

    fun proof(key: ByteArray, vararg pieces: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return base64(mac.doFinal(pieces.joinToString("|").toByteArray(StandardCharsets.UTF_8)))
    }

    fun encrypt(deviceId: String, key: ByteArray, message: WireMessage): EncryptedEnvelope {
        val timestamp = Instant.now().epochSecond
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val nonceText = base64(nonce)
        val aad = "$deviceId|$timestamp|$nonceText".toByteArray(StandardCharsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        return EncryptedEnvelope(deviceId, timestamp, nonceText, base64(cipher.doFinal(json.encodeToString(message).toByteArray())))
    }

    fun decrypt(envelope: EncryptedEnvelope, key: ByteArray): WireMessage {
        require(kotlin.math.abs(Instant.now().epochSecond - envelope.timestamp) <= 60) { "Message expired" }
        val replay = "${envelope.deviceId}:${envelope.nonce}"
        require(seen.putIfAbsent(replay, envelope.timestamp) == null) { "Message replay rejected" }
        seen.entries.removeIf { Instant.now().epochSecond - it.value > 60 }
        val nonce = decode(envelope.nonce)
        require(nonce.size == 12) { "Invalid nonce" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD("${envelope.deviceId}|${envelope.timestamp}|${envelope.nonce}".toByteArray())
        return json.decodeFromString(cipher.doFinal(decode(envelope.ciphertext)).decodeToString())
    }

    fun json() = json
}
