package ai.shree.companion.control

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.flow.MutableStateFlow

class ShreeNotificationService : NotificationListenerService() {
    companion object {
        val summaries = MutableStateFlow<List<String>>(emptyList())
    }
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
