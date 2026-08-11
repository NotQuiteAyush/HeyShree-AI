package ai.shree.companion

import android.app.Application
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.shree.companion.control.ShreeLinkService
import ai.shree.companion.protocol.CredentialStore
import ai.shree.companion.protocol.CompanionData
import ai.shree.companion.protocol.PairingClient
import ai.shree.companion.protocol.ReminderDraft
import ai.shree.companion.protocol.ReminderUpdate
import ai.shree.companion.protocol.WireMessage
import ai.shree.companion.voice.VoiceSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val store = CredentialStore(application)
    val paired = MutableStateFlow(store.load() != null)
    val setupStatus = MutableStateFlow(if (paired.value) "Paired" else "Scan the QR code shown in SHREE Settings")
    val linkStatus: StateFlow<String> = ShreeLinkService.connectionState
    val voiceStatus = MutableStateFlow("idle")
    val transcript = MutableStateFlow("")
    val memories = CompanionData.memories
    val reminders = CompanionData.reminders
    val chat = CompanionData.chat
    val systemStatus = CompanionData.systemStatus
    private var voice: VoiceSession? = null
    private var voiceStatusJob: Job? = null
    private var transcriptJob: Job? = null

    init {
        CompanionData.initialize(application)
        if (paired.value) startLink()
    }

    fun pair(qr: String) = viewModelScope.launch {
        runCatching {
            setupStatus.value = "Connecting to PC…"
            val payload = PairingClient().parseQr(qr)
            val credentials = PairingClient().pair(payload) { setupStatus.value = "Approve this phone in SHREE on your PC" }
            store.save(credentials); paired.value = true; setupStatus.value = "Paired securely"; startLink()
        }.onFailure { setupStatus.value = it.message ?: "Pairing failed" }
    }

    fun reportSetupError(message: String) { setupStatus.value = message }

    fun refreshDashboard() { ShreeLinkService.send(WireMessage(type = "refresh_dashboard")) }
    fun createReminder(text: String) {
        val value = text.trim()
        if (value.isNotEmpty()) ShreeLinkService.send(WireMessage(type = "create_reminder", reminder = ReminderDraft(value)))
    }
    fun toggleReminder(id: String, completed: Boolean) {
        ShreeLinkService.send(WireMessage(type = "update_reminder", reminderId = id, patch = ReminderUpdate(completed)))
    }
    fun deleteReminder(id: String) { ShreeLinkService.send(WireMessage(type = "delete_reminder", reminderId = id)) }

    fun sendText(text: String) {
        val value = text.trim()
        if (value.isEmpty()) return
        val existing = voice
        if (existing != null) {
            if (!existing.sendText(value)) voiceStatus.value = "error: Start a new SHREE session and try again"
            return
        }
        val credentials = store.load() ?: return
        runCatching {
            VoiceSession(getApplication(), credentials).also { session ->
                voice = session
                voiceStatusJob = viewModelScope.launch { session.status.collect { voiceStatus.value = it } }
                transcriptJob = viewModelScope.launch { session.transcript.collect { transcript.value = it } }
                session.startText(value)
            }
        }.onFailure { voiceStatus.value = "error: ${it.message}" }
    }

    fun toggleVoice() {
        if (voice != null) {
            val retryFailedSession = voiceStatus.value.startsWith("error")
            stopVoice()
            if (!retryFailedSession) return
        }
        val credentials = store.load() ?: return
        runCatching {
            VoiceSession(getApplication(), credentials).also { session ->
                voice = session
                voiceStatusJob = viewModelScope.launch { session.status.collect { voiceStatus.value = it } }
                transcriptJob = viewModelScope.launch { session.transcript.collect { transcript.value = it } }
                session.start()
            }
        }.onFailure { voiceStatus.value = "error: ${it.message}" }
    }

    fun unpair() {
        stopVoice(); store.clear(); paired.value = false; setupStatus.value = "Pairing removed"
        getApplication<Application>().stopService(Intent(getApplication(), ShreeLinkService::class.java))
    }

    private fun stopVoice() {
        voiceStatusJob?.cancel(); voiceStatusJob = null
        transcriptJob?.cancel(); transcriptJob = null
        voice?.destroy(); voice = null
        voiceStatus.value = "idle"
    }

    private fun startLink() = ContextCompat.startForegroundService(getApplication(), Intent(getApplication(), ShreeLinkService::class.java).setAction(ShreeLinkService.ACTION_START))
    override fun onCleared() { stopVoice(); super.onCleared() }
}
