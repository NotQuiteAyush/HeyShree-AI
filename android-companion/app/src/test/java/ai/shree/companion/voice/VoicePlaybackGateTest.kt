package ai.shree.companion.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePlaybackGateTest {
    @Test
    fun microphone_upload_is_blocked_for_the_entire_response_playback() {
        val gate = VoicePlaybackGate()

        assertTrue(gate.mayUploadMicrophone())
        gate.responseAudioStarted()
        assertFalse(gate.mayUploadMicrophone())
        gate.responsePlaybackFinished()
        assertTrue(gate.mayUploadMicrophone())
    }
}
