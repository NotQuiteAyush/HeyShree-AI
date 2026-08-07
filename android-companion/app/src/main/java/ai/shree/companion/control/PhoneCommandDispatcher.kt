package ai.shree.companion.control

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.AlarmClock
import android.provider.Settings
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume

data class Confirmation(val title: String, val details: String, val answer: (Boolean) -> Unit)

class PhoneCommandDispatcher(
    private val context: Context,
    private val requestConfirmation: suspend (String, String) -> Boolean,
) {
    suspend fun execute(action: String, arguments: Map<String, JsonElement>): JsonElement {
        return try {
            when (action) {
                "open_url" -> {
                    val url = string(arguments, "url")
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened $url")
                }
                "open_app" -> {
                    val requested = string(arguments, "package")
                    val packageName = mapOf(
                        "youtube" to "com.google.android.youtube", "chrome" to "com.android.chrome",
                        "whatsapp" to "com.whatsapp", "discord" to "com.discord",
                        "spotify" to "com.spotify.music", "gmail" to "com.google.android.gm",
                        "maps" to "com.google.android.apps.maps", "settings" to "com.android.settings",
                    )[requested.lowercase()] ?: requested
                    val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: error("App is not installed")
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened $packageName")
                }
                "set_volume" -> {
                    val audio = context.getSystemService(AudioManager::class.java)
                    val percent = number(arguments, "percent").coerceIn(0.0, 100.0)
                    val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, (max * percent / 100.0).toInt(), 0)
                    val actual = audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / max
                    success("Phone media volume is $actual%", "value", actual)
                }
                "media" -> {
                    val audio = context.getSystemService(AudioManager::class.java)
                    val keyCode = when (string(arguments, "command")) {
                        "play_pause" -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                        "next" -> android.view.KeyEvent.KEYCODE_MEDIA_NEXT
                        "previous" -> android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS
                        "stop" -> android.view.KeyEvent.KEYCODE_MEDIA_STOP
                        else -> error("Unsupported media command")
                    }
                    audio.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, keyCode))
                    audio.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, keyCode))
                    success("Media command sent")
                }
                "write_clipboard" -> {
                    val value = string(arguments, "text")
                    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("SHREE", value))
                    success("Copied text to phone clipboard")
                }
                "read_notifications" -> success(ShreeNotificationService.summaries.value.joinToString("\n").ifBlank { "No accessible notifications" })
                "call" -> {
                    val number = string(arguments, "number")
                    requireApproval("Place phone call?", "Call $number from this phone")
                    context.startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Call started")
                }
                "send_sms" -> {
                    val number = string(arguments, "number"); val message = string(arguments, "message")
                    requireApproval("Send message?", "Send to $number:\n$message")
                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).putExtra("sms_body", message).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Message is ready in the phone messaging app")
                }
                "type_text" -> {
                    val text = string(arguments, "text")
                    requireApproval("Type text?", "SHREE will type into the currently focused phone field.")
                    check(ShreeAccessibilityService.instance?.typeText(text) == true) { "Enable SHREE Accessibility and focus a text field" }
                    success("Typed the requested text")
                }
                "click_text" -> {
                    val label = string(arguments, "text")
                    check(ShreeAccessibilityService.instance?.clickText(label) == true) { "Visible button was not found; enable Accessibility if needed" }
                    success("Clicked $label")
                }
                "tap" -> {
                    val x = number(arguments, "x").toFloat(); val y = number(arguments, "y").toFloat()
                    val service = ShreeAccessibilityService.instance ?: error("Enable SHREE Accessibility first")
                    val worked = suspendCancellableCoroutine { continuation -> service.tap(x, y) { continuation.resume(it) } }
                    check(worked) { "Tap was cancelled" }; success("Tapped the screen")
                }
                "open_accessibility_settings" -> {
                    context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened Accessibility settings")
                }
                "flashlight" -> {
                    val manager = context.getSystemService(CameraManager::class.java)
                    val camera = manager.cameraIdList.firstOrNull { id -> manager.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
                        ?: error("This phone has no controllable flashlight")
                    val enabled = boolean(arguments, "enabled"); manager.setTorchMode(camera, enabled)
                    success(if (enabled) "Flashlight turned on" else "Flashlight turned off")
                }
                "battery_status" -> {
                    val battery = context.getSystemService(BatteryManager::class.java)
                    val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                    success("Phone battery is $level%", "percent", level)
                }
                "open_settings" -> {
                    val action = when (string(arguments, "section").lowercase()) {
                        "wifi" -> Settings.ACTION_WIFI_SETTINGS
                        "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                        "display" -> Settings.ACTION_DISPLAY_SETTINGS
                        "sound" -> Settings.ACTION_SOUND_SETTINGS
                        "battery" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
                        "notifications" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
                        else -> Settings.ACTION_SETTINGS
                    }
                    context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened phone settings")
                }
                "set_alarm" -> {
                    val hour = number(arguments, "hour").toInt(); val minute = number(arguments, "minute").toInt()
                    context.startActivity(Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, hour).putExtra(AlarmClock.EXTRA_MINUTES, minute)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, string(arguments, "label")).putExtra(AlarmClock.EXTRA_SKIP_UI, false).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened the alarm confirmation")
                }
                "open_camera" -> {
                    context.startActivity(Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened camera")
                }
                "share_text" -> {
                    val text = string(arguments, "text")
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened Android share sheet")
                }
                else -> error("Phone action '$action' is not supported")
            }
        } catch (error: Throwable) {
            buildJsonObject { put("success", false); put("error", error.message ?: "Phone action failed") }
        }
    }

    private suspend fun requireApproval(title: String, details: String) {
        check(requestConfirmation(title, details)) { "User denied the action" }
    }
    private fun string(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content ?: error("Missing $key")
    private fun number(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content?.toDoubleOrNull() ?: error("Invalid $key")
    private fun boolean(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: error("Invalid $key")
    private fun success(message: String, key: String? = null, value: Int? = null) = buildJsonObject {
        put("success", true); put("message", message); if (key != null && value != null) put(key, value)
    }
}
