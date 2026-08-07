package ai.shree.companion.protocol

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class CredentialStore(context: Context) {
    companion object {
        private const val ALIAS = "shree_companion_pairing_key"
        private const val VALUE = "encrypted_pairing"
    }
    @Serializable private data class StoredCredentials(
        val host: String,
        val deviceId: String,
        val key: String,
        val relayUrl: String? = null,
        val relayRoomId: String? = null,
        val relayToken: String? = null,
    )
    private val prefs = context.getSharedPreferences("shree_pairing", Context.MODE_PRIVATE)
    private val json = Json

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build())
            generateKey()
        }
    }

    fun save(credentials: PairingCredentials) {
        val clear = json.encodeToString(StoredCredentials(credentials.host, credentials.deviceId, ProtocolCrypto.base64(credentials.key), credentials.relayUrl, credentials.relayRoomId, credentials.relayToken)).encodeToByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val combined = cipher.iv + cipher.doFinal(clear)
        prefs.edit().putString(VALUE, Base64.encodeToString(combined, Base64.NO_WRAP)).apply()
    }

    fun load(): PairingCredentials? = runCatching {
        val combined = Base64.decode(prefs.getString(VALUE, null) ?: return null, Base64.NO_WRAP)
        require(combined.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
        }
        val stored = json.decodeFromString<StoredCredentials>(cipher.doFinal(combined.copyOfRange(12, combined.size)).decodeToString())
        PairingCredentials(stored.host, stored.deviceId, ProtocolCrypto.decode(stored.key), stored.relayUrl, stored.relayRoomId, stored.relayToken)
    }.getOrNull()

    fun clear() {
        prefs.edit().clear().apply()
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
    }
}
