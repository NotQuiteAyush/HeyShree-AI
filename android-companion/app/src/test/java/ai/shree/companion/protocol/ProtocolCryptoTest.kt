package ai.shree.companion.protocol

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolCryptoTest {
    @Test
    fun compactWorldwidePairingProtocolIsAccepted() {
        val payload = PairingPayload(
            protocol = 2,
            app = "Shree Companion",
            pairingId = "pairing",
            deviceId = "device",
            key = "key",
            hosts = emptyList(),
            relay = RelayDescriptor("https://relay.example", "room", "token"),
            expiresAt = "2026-08-07T00:00:00Z",
        )

        assertTrue(supportsPairingPayload(payload))
        assertFalse(supportsPairingPayload(payload.copy(protocol = 3)))
    }

    @Test
    fun microphonePcmUsesStandardBase64RequiredByTheLiveBridge() {
        val pcm = byteArrayOf(0xFB.toByte(), 0xFF.toByte())
        val encoded = ProtocolCrypto.audioBase64(pcm)

        assertEquals("+/8=", encoded)
        assertArrayEquals(pcm, ProtocolCrypto.decodeAudio(encoded))
    }

    @Test
    fun transcriptFragmentsFormOneContinuousUtterance() {
        var transcript = ""
        for (fragment in listOf("कुछ", "एक", "फाइल खुली हैं", "फाइल खुली हैं।")) {
            transcript = mergeTranscriptFragments(transcript, fragment)
        }
        assertEquals("कुछ एक फाइल खुली हैं।", transcript)
    }
}
