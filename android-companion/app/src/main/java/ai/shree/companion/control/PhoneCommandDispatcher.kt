package ai.shree.companion.control

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.AudioManager
import android.app.NotificationManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.location.LocationManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.view.Surface
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
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
                        "instagram" to "com.instagram.android", "camera" to "camera",
                        "gallery" to "gallery", "files" to "files", "file manager" to "files",
                    )[requested.lowercase()] ?: requested
                    if (packageName == "camera") return execute("open_camera", emptyMap())
                    if (packageName == "gallery") return execute("open_gallery", emptyMap())
                    if (packageName == "files") return execute("open_files", emptyMap())
                    val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: error("App is not installed")
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened $packageName")
                }
                "open_dialer" -> {
                    val number = optionalString(arguments, "number").orEmpty()
                    context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(number)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened the phone dialer")
                }
                "end_call" -> error("Android does not let ordinary apps end calls. Make SHREE the system dialer to enable this capability.")
                "find_contact", "contact_phone" -> findContacts(string(arguments, "query"))
                "search_apps" -> searchApps(string(arguments, "query"))
                "close_app" -> {
                    val service = ShreeAccessibilityService.instance ?: error("Enable SHREE Accessibility first")
                    check(service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)) { "Android could not leave the current app" }
                    success("Returned to the Home screen")
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
                        "play" -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY
                        "pause" -> android.view.KeyEvent.KEYCODE_MEDIA_PAUSE
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
                "read_clipboard" -> {
                    val clipboard = context.getSystemService(ClipboardManager::class.java)
                    val value = clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
                    check(value.isNotBlank()) { "Android only allows clipboard reads while SHREE is visible, and the clipboard is empty or unavailable" }
                    success(value)
                }
                "read_notifications" -> success(ShreeNotificationService.summaries.value.joinToString("\n").ifBlank { "No accessible notifications" })
                "reply_notification" -> {
                    val query = string(arguments, "query"); val message = string(arguments, "message")
                    requireApproval("Reply to notification?", "Send this reply to $query:\n$message")
                    check(ShreeNotificationService.reply(query, message)) { "No replyable notification matched '$query'" }
                    success("Reply sent")
                }
                "call" -> {
                    val requested = string(arguments, "number"); val number = resolvePhoneNumber(requested) ?: requested
                    requireApproval("Place phone call?", "Call $number from this phone")
                    context.startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Call started")
                }
                "send_sms" -> {
                    val requested = string(arguments, "number"); val number = resolvePhoneNumber(requested) ?: requested; val message = string(arguments, "message")
                    requireApproval("Send message?", "Send to $number:\n$message")
                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).putExtra("sms_body", message).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Message is ready in the phone messaging app")
                }
                "send_whatsapp" -> {
                    val requested = string(arguments, "target"); val number = (resolvePhoneNumber(requested) ?: requested).filter { it.isDigit() || it == '+' }
                    val message = string(arguments, "message")
                    requireApproval("Send WhatsApp message?", "Open WhatsApp for $requested with:\n$message")
                    val uri = if (number.isNotBlank()) "https://wa.me/${number.trimStart('+')}?text=${Uri.encode(message)}" else "https://wa.me/?text=${Uri.encode(message)}"
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage("com.whatsapp").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened WhatsApp with the message ready; tap Send to finish")
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
                "charging_status" -> {
                    val battery = context.getSystemService(BatteryManager::class.java)
                    val charging = battery.isCharging
                    success(if (charging) "Phone is charging" else "Phone is not charging")
                }
                "storage_status" -> {
                    val stat = StatFs(Environment.getDataDirectory().path)
                    val freeGb = stat.availableBytes.toDouble() / 1_073_741_824.0
                    val totalGb = stat.totalBytes.toDouble() / 1_073_741_824.0
                    success("${"%.1f".format(freeGb)} GB available of ${"%.1f".format(totalGb)} GB")
                }
                "device_info" -> success("${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                "open_settings" -> {
                    val action = when (string(arguments, "section").lowercase()) {
                        "wifi" -> Settings.ACTION_WIFI_SETTINGS
                        "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                        "display" -> Settings.ACTION_DISPLAY_SETTINGS
                        "sound" -> Settings.ACTION_SOUND_SETTINGS
                        "battery" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
                        "notifications" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
                        "mobile_data" -> Settings.ACTION_DATA_ROAMING_SETTINGS
                        "hotspot" -> Settings.ACTION_WIRELESS_SETTINGS
                        "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
                        "files" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
                        else -> Settings.ACTION_SETTINGS
                    }
                    context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened phone settings")
                }
                "bluetooth" -> {
                    context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened Bluetooth settings; Android requires you to confirm the change")
                }
                "do_not_disturb" -> {
                    val manager = context.getSystemService(NotificationManager::class.java)
                    if (!manager.isNotificationPolicyAccessGranted) {
                        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        error("Grant SHREE Do Not Disturb access, then try again")
                    }
                    val enabled = boolean(arguments, "enabled")
                    manager.setInterruptionFilter(if (enabled) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
                    success(if (enabled) "Do Not Disturb turned on" else "Do Not Disturb turned off")
                }
                "adjust_volume" -> {
                    val audio = context.getSystemService(AudioManager::class.java)
                    val direction = if (string(arguments, "direction").lowercase() == "increase") AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
                    success("Phone media volume adjusted")
                }
                "mute" -> {
                    val audio = context.getSystemService(AudioManager::class.java); val enabled = boolean(arguments, "enabled")
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (enabled) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI)
                    success(if (enabled) "Phone media muted" else "Phone media unmuted")
                }
                "set_brightness" -> setBrightness(number(arguments, "percent").toInt())
                "adjust_brightness" -> {
                    val current = Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) * 100 / 255
                    val delta = if (string(arguments, "direction").lowercase() == "increase") 10 else -10
                    setBrightness((current + delta).coerceIn(1, 100))
                }
                "set_orientation" -> setOrientation(string(arguments, "query"))
                "set_alarm" -> {
                    val hour = number(arguments, "hour").toInt(); val minute = number(arguments, "minute").toInt()
                    context.startActivity(Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, hour).putExtra(AlarmClock.EXTRA_MINUTES, minute)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, string(arguments, "label")).putExtra(AlarmClock.EXTRA_SKIP_UI, false).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened the alarm confirmation")
                }
                "cancel_alarm" -> {
                    context.startActivity(Intent(AlarmClock.ACTION_DISMISS_ALARM).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened alarm dismissal")
                }
                "set_timer" -> {
                    val seconds = number(arguments, "minutes").toInt().coerceAtLeast(1) * 60
                    context.startActivity(Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, optionalString(arguments, "label") ?: "SHREE timer").putExtra(AlarmClock.EXTRA_SKIP_UI, false).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened the timer confirmation")
                }
                "cancel_timer" -> {
                    context.startActivity(Intent(AlarmClock.ACTION_DISMISS_TIMER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened timer dismissal")
                }
                "open_camera" -> {
                    context.startActivity(Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened camera")
                }
                "open_gallery" -> {
                    context.startActivity(Intent(Intent.ACTION_VIEW, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).setType("image/*").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened gallery")
                }
                "open_files" -> {
                    context.startActivity(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened Files")
                }
                "record_audio" -> {
                    context.startActivity(Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Opened audio recorder")
                }
                "share_text" -> {
                    val text = string(arguments, "text")
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened Android share sheet")
                }
                "share_link" -> {
                    val text = string(arguments, "text")
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share link with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened Android share sheet")
                }
                "web_search" -> openWebSearch(string(arguments, "query"), false)
                "youtube_search" -> openWebSearch(string(arguments, "query"), true)
                "maps_search" -> {
                    val query = string(arguments, "query")
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(query)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Searching Maps for $query")
                }
                "navigate" -> {
                    val query = string(arguments, "query")
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=${Uri.encode(query)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); success("Started navigation to $query")
                }
                "current_location" -> currentLocation()
                "calendar_create" -> {
                    val title = string(arguments, "title"); val details = optionalString(arguments, "details").orEmpty()
                    context.startActivity(Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.Events.TITLE, title).putExtra(CalendarContract.Events.DESCRIPTION, details).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    success("Opened the calendar event editor")
                }
                "calendar_read" -> readCalendar()
                "save_note" -> saveNote(string(arguments, "text"))
                "list_notes" -> listNotes()
                "delete_note" -> deleteNote(string(arguments, "query"))
                else -> error("Phone action '$action' is not supported")
            }
        } catch (error: Throwable) {
            buildJsonObject { put("success", false); put("error", error.message ?: "Phone action failed") }
        }
    }

    private suspend fun requireApproval(title: String, details: String) {
        check(requestConfirmation(title, details)) { "User denied the action" }
    }
    private fun findContacts(query: String): JsonElement {
        check(ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            "Grant SHREE Contacts permission in Android settings"
        }
        val matches = mutableListOf<String>()
        val projection = arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER)
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?", arrayOf("%$query%"),
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC",
        )?.use { cursor ->
            val nameIndex = cursor.getColumnIndexOrThrow(projection[0]); val numberIndex = cursor.getColumnIndexOrThrow(projection[1])
            while (cursor.moveToNext() && matches.size < 10) matches += "${cursor.getString(nameIndex)}: ${cursor.getString(numberIndex)}"
        }
        return success(matches.joinToString("\n").ifBlank { "No contact matched $query" })
    }
    private fun resolvePhoneNumber(query: String): String? {
        if (query.any(Char::isDigit)) return query
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null
        val projection = arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER)
        return context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?", arrayOf("%$query%"), null,
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }
    private fun searchApps(query: String): JsonElement {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = context.packageManager.queryIntentActivities(launcher, 0)
            .map { "${it.loadLabel(context.packageManager)} (${it.activityInfo.packageName})" }
            .filter { it.contains(query, ignoreCase = true) }.distinct().sorted().take(20)
        return success(apps.joinToString("\n").ifBlank { "No installed app matched $query" })
    }
    private fun setBrightness(percent: Int): JsonElement {
        if (!Settings.System.canWrite(context)) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            error("Allow SHREE to modify system settings, then try again")
        }
        val actual = percent.coerceIn(1, 100)
        Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, actual * 255 / 100)
        return success("Phone brightness set to $actual%", "value", actual)
    }
    private fun setOrientation(value: String): JsonElement {
        if (!Settings.System.canWrite(context)) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            error("Allow SHREE to modify system settings, then try again")
        }
        val normalized = value.lowercase()
        if (normalized in setOf("auto", "automatic", "rotate")) {
            Settings.System.putInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 1)
        } else {
            Settings.System.putInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0)
            val rotation = if (normalized.startsWith("land")) Surface.ROTATION_90 else Surface.ROTATION_0
            Settings.System.putInt(context.contentResolver, Settings.System.USER_ROTATION, rotation)
        }
        return success("Screen orientation set to $value")
    }
    private fun openWebSearch(query: String, youtube: Boolean): JsonElement {
        val uri = if (youtube) "https://www.youtube.com/results?search_query=${Uri.encode(query)}" else "https://www.google.com/search?q=${Uri.encode(query)}"
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return success(if (youtube) "Searching YouTube for $query" else "Searching Google for $query")
    }
    private fun currentLocation(): JsonElement {
        val fine = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        check(fine || coarse) { "Grant SHREE Location permission in Android settings" }
        val manager = context.getSystemService(LocationManager::class.java)
        val location = manager.getProviders(true).mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time } ?: error("Current location is not available yet")
        return success("Current location: ${location.latitude}, ${location.longitude}")
    }
    private fun readCalendar(): JsonElement {
        check(ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) {
            "Grant SHREE Calendar permission in Android settings"
        }
        val now = System.currentTimeMillis(); val end = now + 7L * 24 * 60 * 60 * 1000
        val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        android.content.ContentUris.appendId(builder, now); android.content.ContentUris.appendId(builder, end)
        val events = mutableListOf<String>()
        context.contentResolver.query(builder.build(), arrayOf(CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN), null, null, CalendarContract.Instances.BEGIN + " ASC")?.use { cursor ->
            while (cursor.moveToNext() && events.size < 20) events += "${cursor.getString(0)} — ${java.util.Date(cursor.getLong(1))}"
        }
        return success(events.joinToString("\n").ifBlank { "No calendar events in the next seven days" })
    }
    private fun saveNote(text: String): JsonElement {
        val preferences = context.getSharedPreferences("shree_notes", Context.MODE_PRIVATE)
        val notes = preferences.getStringSet("notes", emptySet()).orEmpty().toMutableSet(); notes += text.trim()
        preferences.edit().putStringSet("notes", notes).apply()
        return success("Note saved")
    }
    private fun listNotes(): JsonElement {
        val notes = context.getSharedPreferences("shree_notes", Context.MODE_PRIVATE).getStringSet("notes", emptySet()).orEmpty().sorted()
        return success(notes.joinToString("\n").ifBlank { "No saved phone notes" })
    }
    private fun deleteNote(query: String): JsonElement {
        val preferences = context.getSharedPreferences("shree_notes", Context.MODE_PRIVATE)
        val notes = preferences.getStringSet("notes", emptySet()).orEmpty().toMutableSet()
        val removed = notes.filter { it.contains(query, ignoreCase = true) }
        check(removed.isNotEmpty()) { "No saved note matched $query" }
        notes.removeAll(removed.toSet()); preferences.edit().putStringSet("notes", notes).apply()
        return success("Deleted ${removed.size} matching note(s)")
    }
    private fun string(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content ?: error("Missing $key")
    private fun optionalString(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content
    private fun number(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content?.toDoubleOrNull() ?: error("Invalid $key")
    private fun boolean(values: Map<String, JsonElement>, key: String) = (values[key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: error("Invalid $key")
    private fun success(message: String, key: String? = null, value: Int? = null) = buildJsonObject {
        put("success", true); put("message", message); if (key != null && value != null) put(key, value)
    }
}
