package ai.shree.companion.control

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import kotlinx.coroutines.flow.MutableStateFlow

class ShreeNotificationService : NotificationListenerService() {
    companion object {
        val summaries = MutableStateFlow<List<String>>(emptyList())
        @Volatile private var active: ShreeNotificationService? = null

        fun reply(query: String, message: String): Boolean {
            val service = active ?: return false
            val notification = service.activeNotifications.firstOrNull { sbn ->
                val title = sbn.notification.extras.getCharSequence("android.title")?.toString().orEmpty()
                val text = sbn.notification.extras.getCharSequence("android.text")?.toString().orEmpty()
                sbn.packageName.contains(query, true) || title.contains(query, true) || text.contains(query, true)
            }?.notification ?: return false
            val action = notification.actions?.firstOrNull { it.remoteInputs?.isNotEmpty() == true } ?: return false
            val inputs = action.remoteInputs ?: return false
            val results = Bundle().apply { inputs.forEach { putCharSequence(it.resultKey, message) } }
            val fillIn = Intent()
            RemoteInput.addResultsToIntent(inputs, fillIn, results)
            return runCatching { action.actionIntent.send(service, 0, fillIn); true }.getOrDefault(false)
        }
    }
    override fun onListenerConnected() { active = this; super.onListenerConnected() }
    override fun onListenerDisconnected() { if (active === this) active = null; super.onListenerDisconnected() }
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val title = sbn.notification.extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = sbn.notification.extras.getCharSequence("android.text")?.toString().orEmpty()
        val safe = "${sbn.packageName}: $title $text".trim()
        summaries.value = (listOf(safe) + summaries.value).distinct().take(20)
    }
    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        summaries.value = summaries.value.filterNot { it.startsWith("${sbn.packageName}:") }
    }
}
