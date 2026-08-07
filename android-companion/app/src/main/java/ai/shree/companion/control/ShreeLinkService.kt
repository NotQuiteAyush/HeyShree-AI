package ai.shree.companion.control

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import ai.shree.companion.MainActivity
import ai.shree.companion.protocol.CredentialStore
import ai.shree.companion.protocol.CompanionData
import ai.shree.companion.protocol.EncryptedSocket
import ai.shree.companion.protocol.WireMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

class ShreeLinkService : Service() {
    companion object {
        val connectionState = MutableStateFlow("offline")
        const val ACTION_START = "ai.shree.companion.START_LINK"
        const val ACTION_STOP = "ai.shree.companion.STOP_LINK"
        @Volatile private var active: ShreeLinkService? = null
        fun send(message: WireMessage): Boolean = active?.socket?.send(message) == true
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var socket: EncryptedSocket? = null

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        active = this
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("shree_link", "SHREE PC connection", NotificationManager.IMPORTANCE_LOW)
        )
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        startForeground(17, NotificationCompat.Builder(this, "shree_link")
            .setSmallIcon(ai.shree.companion.R.drawable.shree_mark)
            .setContentTitle("SHREE Companion")
            .setContentText("Encrypted link to your SHREE PC")
            .setContentIntent(open).setOngoing(true).build())
        connect()
        return START_STICKY
    }

    private fun connect() {
        if (socket != null) return
        val credentials = CredentialStore(this).load() ?: run { stopSelf(); return }
        val dispatcher = PhoneCommandDispatcher(this) { title, details ->
            val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            getSystemService(NotificationManager::class.java).notify(18, NotificationCompat.Builder(this, "shree_link")
                .setSmallIcon(ai.shree.companion.R.drawable.shree_mark).setContentTitle(title).setContentText(details)
                .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(open).setAutoCancel(true).build())
            ConfirmationBroker.request(title, details)
        }
        socket = EncryptedSocket(credentials, "control", "hello", autoReconnect = true) { message, channel ->
            CompanionData.consume(message)
            when (message.type) {
                "phone_command" -> {
                    val id = message.id ?: return@EncryptedSocket
                    val result = dispatcher.execute(message.action.orEmpty(), message.arguments.orEmpty())
                    channel.sendResult(id, result)
                }
                "connected" -> {
                    connectionState.value = "connected"
                    channel.send(WireMessage(type = "refresh_dashboard"))
                }
            }
        }.also { channel ->
            scope.launch { channel.state.collect { connectionState.value = it } }
            channel.connect()
        }
    }

    override fun onDestroy() { if (active === this) active = null; socket?.destroy(); socket = null; connectionState.value = "offline"; scope.cancel(); super.onDestroy() }
}
