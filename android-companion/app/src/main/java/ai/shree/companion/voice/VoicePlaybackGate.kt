package ai.shree.companion.voice

import java.util.concurrent.atomic.AtomicBoolean

internal class VoicePlaybackGate {
    private val responseAudible = AtomicBoolean(false)

    fun responseAudioStarted() {
        responseAudible.set(true)
    }

    fun responsePlaybackFinished() {
        responseAudible.set(false)
    }

    fun mayUploadMicrophone(): Boolean = !responseAudible.get()
}
